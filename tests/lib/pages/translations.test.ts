import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { linkTranslation, listLinkedTranslations } from '@/lib/pages/translations';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed(): Promise<{ userId: string; workspaceId: string }> {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `u-${Date.now()}-${Math.random()}@example.com`,
      name: 'U',
      passwordHash: 'x',
    })
    .returning({ id: schema.users.id });
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })
    .returning({ id: schema.workspaces.id });
  return { userId: u!.id, workspaceId: w!.id };
}

async function newPage(workspaceId: string, userId: string, title: string): Promise<schema.Page> {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
    .returning();
  return p!;
}

describe('translations — symmetric linkage', () => {
  it('linkTranslation sets translation_of_page_id + locale', async () => {
    const { userId, workspaceId } = await seed();
    const en = await newPage(workspaceId, userId, 'EN');
    const es = await newPage(workspaceId, userId, 'ES');
    await linkTranslation(db, {
      pageId: es.id,
      canonicalPageId: en.id,
      locale: 'es',
      byUserId: userId,
    });
    const [refreshed] = await db.select().from(schema.pages).where(eq(schema.pages.id, es.id));
    expect(refreshed!.translationOfPageId).toBe(en.id);
    expect(refreshed!.translationLocale).toBe('es');
  });

  it('refuses cross-workspace canonical', async () => {
    const a = await seed();
    const b = await seed();
    const pA = await newPage(a.workspaceId, a.userId, 'A');
    const pB = await newPage(b.workspaceId, b.userId, 'B');
    await expect(
      linkTranslation(db, {
        pageId: pB.id,
        canonicalPageId: pA.id,
        locale: 'fr',
        byUserId: b.userId,
      }),
    ).rejects.toThrow();
  });

  it('refuses self-link (cycle of length 1)', async () => {
    const { userId, workspaceId } = await seed();
    const p = await newPage(workspaceId, userId, 'P');
    await expect(
      linkTranslation(db, {
        pageId: p.id,
        canonicalPageId: p.id,
        locale: 'es',
        byUserId: userId,
      }),
    ).rejects.toThrow();
  });

  it('listLinkedTranslations returns every page pointing at the canonical (symmetric view)', async () => {
    const { userId, workspaceId } = await seed();
    const en = await newPage(workspaceId, userId, 'EN');
    const es = await newPage(workspaceId, userId, 'ES');
    const fr = await newPage(workspaceId, userId, 'FR');
    await linkTranslation(db, {
      pageId: es.id,
      canonicalPageId: en.id,
      locale: 'es',
      byUserId: userId,
    });
    await linkTranslation(db, {
      pageId: fr.id,
      canonicalPageId: en.id,
      locale: 'fr',
      byUserId: userId,
    });
    const linked = await listLinkedTranslations(db, { canonicalPageId: en.id });
    const ids = linked.map((r) => r.id).sort();
    expect(ids).toEqual([es.id, fr.id].sort());
  });

  it('listLinkedTranslations from a sibling resolves to the canonical and lists the other siblings', async () => {
    const { userId, workspaceId } = await seed();
    const en = await newPage(workspaceId, userId, 'EN');
    const es = await newPage(workspaceId, userId, 'ES');
    const fr = await newPage(workspaceId, userId, 'FR');
    await linkTranslation(db, {
      pageId: es.id,
      canonicalPageId: en.id,
      locale: 'es',
      byUserId: userId,
    });
    await linkTranslation(db, {
      pageId: fr.id,
      canonicalPageId: en.id,
      locale: 'fr',
      byUserId: userId,
    });
    const linkedFromEs = await listLinkedTranslations(db, { canonicalPageId: es.id });
    // Walking from a sibling: canonical resolves to en; siblings returned are
    // en + fr (es is the caller and excluded).
    expect(linkedFromEs.map((r) => r.id).sort()).toEqual([en.id, fr.id].sort());
  });

  it('writes a page.translation_linked audit row on success', async () => {
    const { userId, workspaceId } = await seed();
    const en = await newPage(workspaceId, userId, 'EN');
    const es = await newPage(workspaceId, userId, 'ES');
    await linkTranslation(db, {
      pageId: es.id,
      canonicalPageId: en.id,
      locale: 'es',
      byUserId: userId,
    });
    const rows = await db.select().from(schema.auditLog);
    const linked = rows.find((r) => r.action === 'page.translation_linked');
    expect(linked).toBeTruthy();
    expect(linked!.workspaceId).toBe(workspaceId);
    expect(linked!.metadata).toMatchObject({ locale: 'es', canonicalPageId: en.id });
  });
});
