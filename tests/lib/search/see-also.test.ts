import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { findRelatedPages } from '@/lib/search/see-also';
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
  await sql`TRUNCATE page_embeddings, page_acls, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

function fakeEmbedding(seed: number): number[] {
  // Deterministic 384-dim vector. seed=0 is uniform 0.001; bigger seed shifts
  // weight to early dimensions so distance ordering is predictable in tests.
  const v = new Array(384).fill(0.001);
  for (let i = 0; i < 8; i++) v[i] = (seed + i * 0.01) / 10;
  return v;
}

async function seedWorkspace() {
  const slug = `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [u] = await db
    .insert(schema.users)
    .values({ email: `u-${slug}@example.com`, name: 'U', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug })
    .returning({ id: schema.workspaces.id });
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: w!.id, userId: u!.id, role: 'owner' });
  return { userId: u!.id, workspaceId: w!.id };
}

async function makePage(
  workspaceId: string,
  userId: string,
  title: string,
  options: { encrypted?: boolean; status?: schema.PageStatus; embedSeed?: number } = {},
) {
  const [p] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      title,
      contentText: title.toLowerCase(),
      createdBy: userId,
      ...(options.encrypted === true ? { encrypted: true } : {}),
      ...(options.status ? { status: options.status } : {}),
    } as never)
    .returning();
  if (options.embedSeed !== undefined) {
    await db.insert(schema.pageEmbeddings).values({
      pageId: p!.id,
      workspaceId,
      embedding: fakeEmbedding(options.embedSeed),
      contentHash: `h-${title}`,
    });
  }
  return p!;
}

describe('findRelatedPages', () => {
  it('returns up to N nearest pages, ordered by cosine distance asc', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Source', { embedSeed: 0 });
    const close = await makePage(workspaceId, userId, 'Close', { embedSeed: 0.1 });
    const mid = await makePage(workspaceId, userId, 'Mid', { embedSeed: 1 });
    const far = await makePage(workspaceId, userId, 'Far', { embedSeed: 5 });

    const out = await findRelatedPages(db, { pageId: source.id, viewerUserId: userId, limit: 5 });
    const ids = out.map((r) => r.id);
    expect(ids).not.toContain(source.id); // source itself excluded
    expect(ids[0]).toBe(close.id);
    expect(ids[1]).toBe(mid.id);
    expect(ids[2]).toBe(far.id);
    expect(out.every((r) => typeof r.score === 'number' && r.score >= 0 && r.score <= 1)).toBe(
      true,
    );
  });

  it('excludes encrypted pages (P5 consumer-check call site)', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Src', { embedSeed: 0 });
    await makePage(workspaceId, userId, 'Encrypted neighbor', {
      embedSeed: 0.1,
      encrypted: true,
    });
    const visible = await makePage(workspaceId, userId, 'Plain neighbor', { embedSeed: 1 });
    const out = await findRelatedPages(db, { pageId: source.id, viewerUserId: userId, limit: 5 });
    expect(out.map((r) => r.id)).toEqual([visible.id]);
  });

  it('excludes deleted pages', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Src', { embedSeed: 0 });
    const deleted = await makePage(workspaceId, userId, 'Deleted', { embedSeed: 0.1 });
    await db
      .update(schema.pages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.pages.id, deleted.id));
    const out = await findRelatedPages(db, { pageId: source.id, viewerUserId: userId, limit: 5 });
    expect(out.map((r) => r.id)).not.toContain(deleted.id);
  });

  it('returns empty when the source page has no embedding', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Src'); // no embedSeed
    await makePage(workspaceId, userId, 'Neighbor', { embedSeed: 0.1 });
    const out = await findRelatedPages(db, { pageId: source.id, viewerUserId: userId, limit: 5 });
    expect(out).toEqual([]);
  });

  it('respects the limit', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Src', { embedSeed: 0 });
    for (let i = 1; i <= 10; i++) {
      await makePage(workspaceId, userId, `N${i}`, { embedSeed: i });
    }
    const out = await findRelatedPages(db, { pageId: source.id, viewerUserId: userId, limit: 3 });
    expect(out).toHaveLength(3);
  });

  it('ACL filter — viewer without workspace membership gets nothing', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Src', { embedSeed: 0 });
    await makePage(workspaceId, userId, 'N', { embedSeed: 0.1 });

    // Second user with no membership.
    const [outsider] = await db
      .insert(schema.users)
      .values({ email: `out-${Date.now()}@example.com`, name: 'O', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    const out = await findRelatedPages(db, {
      pageId: source.id,
      viewerUserId: outsider!.id,
      limit: 5,
    });
    expect(out).toEqual([]);
  });

  it('includes published pages in a public-reader (publicViewer=true) call without ACL gating', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Src', { embedSeed: 0 });
    const neighbor = await makePage(workspaceId, userId, 'N', { embedSeed: 0.1 });
    // Anonymous viewer (no user id) on the public reader path. ACL is bypassed
    // but encrypted + deleted + lifecycle status filters still apply.
    const out = await findRelatedPages(db, {
      pageId: source.id,
      viewerUserId: null,
      publicViewer: true,
      limit: 5,
    });
    expect(out.map((r) => r.id)).toEqual([neighbor.id]);
  });

  it('excludes draft and archived pages (P26 lifecycle filter)', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'Src', { embedSeed: 0 });
    await makePage(workspaceId, userId, 'Draft', { embedSeed: 0.1, status: 'draft' });
    await makePage(workspaceId, userId, 'Archived', { embedSeed: 0.2, status: 'archived' });
    const pub = await makePage(workspaceId, userId, 'Pub', {
      embedSeed: 0.3,
      status: 'published',
    });
    const out = await findRelatedPages(db, { pageId: source.id, viewerUserId: userId, limit: 5 });
    expect(out.map((r) => r.id)).toEqual([pub.id]);
  });
});
