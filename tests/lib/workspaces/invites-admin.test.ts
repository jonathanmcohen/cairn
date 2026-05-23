import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listPendingInvites, RevokeInviteError, revokeInvite } from '@/lib/workspaces/invites';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await pg`TRUNCATE workspaces, users, workspace_members, invite_tokens RESTART IDENTITY CASCADE`;
});

async function ws() {
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('ws seed failed');
  return w.id;
}

async function seedInvite(
  workspaceId: string,
  opts: { email?: string; usedAt?: Date | null; expiresAt?: Date } = {},
) {
  const [row] = await db
    .insert(schema.inviteTokens)
    .values({
      workspaceId,
      email: opts.email ?? `${Math.random().toString(36).slice(2)}@example.com`,
      role: 'editor',
      token: `tok-${Math.random().toString(36).slice(2)}`,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 86_400_000),
      usedAt: opts.usedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('invite seed failed');
  return row;
}

describe('listPendingInvites', () => {
  it('returns only unused, unexpired invites for the workspace', async () => {
    const w = await ws();
    const other = await ws();
    const pending = await seedInvite(w, { email: 'pending@example.com' });
    await seedInvite(w, { email: 'used@example.com', usedAt: new Date() });
    await seedInvite(w, {
      email: 'expired@example.com',
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await seedInvite(other, { email: 'cross@example.com' });

    const rows = await listPendingInvites(db, w);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(pending.id);
    expect(rows[0]?.email).toBe('pending@example.com');
  });
});

describe('revokeInvite', () => {
  it('marks a pending invite revoked (sets usedAt)', async () => {
    const w = await ws();
    const inv = await seedInvite(w);
    await revokeInvite(db, { workspaceId: w, inviteId: inv.id });
    const [row] = await db
      .select()
      .from(schema.inviteTokens)
      .where(eq(schema.inviteTokens.id, inv.id));
    expect(row?.usedAt).not.toBeNull();
  });

  it('a second revoke throws NOT_FOUND (idempotent at the route layer)', async () => {
    const w = await ws();
    const inv = await seedInvite(w);
    await revokeInvite(db, { workspaceId: w, inviteId: inv.id });
    await expect(revokeInvite(db, { workspaceId: w, inviteId: inv.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('revoking a cross-workspace invite throws NOT_FOUND', async () => {
    const w = await ws();
    const other = await ws();
    const inv = await seedInvite(other);
    await expect(revokeInvite(db, { workspaceId: w, inviteId: inv.id })).rejects.toBeInstanceOf(
      RevokeInviteError,
    );
  });
});
