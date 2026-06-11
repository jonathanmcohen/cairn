import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { verifyFileUrl } from '@/lib/files/signing';
import { BrandError, getWorkspaceBrand, setWorkspaceBrand } from '@/lib/workspaces/brand';
import { startPostgres, stopPostgres } from '../../helpers/db';

const SECRET = 's'.repeat(32);

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});
afterAll(async () => {
  await pg.end();
  await stopPostgres();
});
beforeEach(async () => {
  await pg`TRUNCATE audit_log, files, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function user(name = 'u') {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}
async function ws(name = 'WS') {
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name, slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  return w.id;
}
async function file(workspaceId: string, uploadedBy: string) {
  const [f] = await db
    .insert(schema.files)
    .values({
      workspaceId,
      name: 'logo.png',
      mimeType: 'image/png',
      size: 67,
      path: `${workspaceId}/logo.png`,
      uploadedBy,
    })
    .returning();
  if (!f) throw new Error('file insert failed');
  return f.id;
}

describe('setWorkspaceBrand / getWorkspaceBrand', () => {
  it('round-trips logo + color and signs the logo URL', async () => {
    const w = await ws();
    const actor = await user();
    const logo = await file(w, actor);

    await setWorkspaceBrand(db, {
      workspaceId: w,
      actorUserId: actor,
      logoFileId: logo,
      primaryColor: '#2563EB', // mixed case — stored normalized
    });

    const brand = await getWorkspaceBrand(db, w, { secret: SECRET });
    expect(brand.logoFileId).toBe(logo);
    expect(brand.primaryColor).toBe('#2563eb');
    // #2563eb already clears 4.5:1 vs #fafafa → unclamped.
    expect(brand.appliedPrimary).toMatchObject({ hex: '#2563eb', clamped: false });
    expect(brand.appliedPrimary?.hsl).toMatch(/^\d+(\.\d)? \d+(\.\d)?% \d+(\.\d)?%$/);

    // The logo URL is HMAC-signed (never a raw path) and verifies.
    const url = new URL(brand.logoUrl ?? '', 'http://localhost');
    expect(url.pathname).toBe(`/api/files/${logo}`);
    const sig = url.searchParams.get('sig') ?? '';
    const exp = Number(url.searchParams.get('exp'));
    expect(verifyFileUrl({ fileId: logo, expiresAt: exp, sig, secret: SECRET })).toBe(true);
    // TTL ~1 h.
    expect(exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(3500);
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600);
  });

  it('null clears; undefined leaves unchanged', async () => {
    const w = await ws();
    const actor = await user();
    const logo = await file(w, actor);
    await setWorkspaceBrand(db, {
      workspaceId: w,
      actorUserId: actor,
      logoFileId: logo,
      primaryColor: '#059669',
    });

    // Color-only update keeps the logo.
    await setWorkspaceBrand(db, { workspaceId: w, actorUserId: actor, primaryColor: '#e11d48' });
    let brand = await getWorkspaceBrand(db, w, { secret: SECRET });
    expect(brand.logoFileId).toBe(logo);
    expect(brand.primaryColor).toBe('#e11d48');

    // Explicit nulls clear both.
    await setWorkspaceBrand(db, {
      workspaceId: w,
      actorUserId: actor,
      logoFileId: null,
      primaryColor: null,
    });
    brand = await getWorkspaceBrand(db, w, { secret: SECRET });
    expect(brand).toEqual({
      logoFileId: null,
      logoUrl: null,
      primaryColor: null,
      appliedPrimary: null,
    });
  });

  it('tenant guard: rejects a logo file from another workspace', async () => {
    const w1 = await ws('W1');
    const w2 = await ws('W2');
    const actor = await user();
    const foreign = await file(w2, actor);

    await expect(
      setWorkspaceBrand(db, { workspaceId: w1, actorUserId: actor, logoFileId: foreign }),
    ).rejects.toMatchObject({ code: 'LOGO_NOT_IN_WORKSPACE' });
    // Nothing written.
    const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, w1));
    expect(row?.brandLogoFileId).toBeNull();
  });

  it('rejects an invalid color without writing', async () => {
    const w = await ws();
    const actor = await user();
    await expect(
      setWorkspaceBrand(db, { workspaceId: w, actorUserId: actor, primaryColor: 'bright-red' }),
    ).rejects.toBeInstanceOf(BrandError);
    const brand = await getWorkspaceBrand(db, w, { secret: SECRET });
    expect(brand.primaryColor).toBeNull();
  });

  it('writes a workspace.brand_updated audit row with {hasLogo, primaryColor}', async () => {
    const w = await ws();
    const actor = await user();
    const logo = await file(w, actor);
    await setWorkspaceBrand(db, {
      workspaceId: w,
      actorUserId: actor,
      logoFileId: logo,
      primaryColor: '#2563eb',
    });

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.workspaceId, w));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'workspace.brand_updated',
      actorUserId: actor,
      targetType: 'workspace',
      targetId: w,
      metadata: { hasLogo: true, primaryColor: '#2563eb' },
    });
  });

  it('read-time clamp: a near-white color written by another path clamps at render', async () => {
    const w = await ws();
    // Bypass setWorkspaceBrand — simulate a hand-edited / legacy row.
    await db
      .update(schema.workspaces)
      .set({ brandPrimaryColor: '#f5f5f5' })
      .where(eq(schema.workspaces.id, w));

    const brand = await getWorkspaceBrand(db, w, { secret: SECRET });
    expect(brand.primaryColor).toBe('#f5f5f5');
    expect(brand.appliedPrimary?.clamped).toBe(true);
    expect(brand.appliedPrimary?.hex).not.toBe('#f5f5f5');
  });

  it('read-time defense: an unparseable stored color renders as unset, not a 500', async () => {
    const w = await ws();
    await db
      .update(schema.workspaces)
      .set({ brandPrimaryColor: 'garbage' })
      .where(eq(schema.workspaces.id, w));
    const brand = await getWorkspaceBrand(db, w, { secret: SECRET });
    expect(brand.primaryColor).toBeNull();
    expect(brand.appliedPrimary).toBeNull();
  });

  it('logo file deletion clears the brand pointer (ON DELETE SET NULL)', async () => {
    const w = await ws();
    const actor = await user();
    const logo = await file(w, actor);
    await setWorkspaceBrand(db, { workspaceId: w, actorUserId: actor, logoFileId: logo });

    await db.delete(schema.files).where(eq(schema.files.id, logo));
    const brand = await getWorkspaceBrand(db, w, { secret: SECRET });
    expect(brand.logoFileId).toBeNull();
    expect(brand.logoUrl).toBeNull();
  });
});
