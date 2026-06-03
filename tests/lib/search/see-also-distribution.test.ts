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

// Deterministic 384-dim vectors with a controllable "angle" from the source so
// the resulting cosine distances span a real band (not a compressed cluster).
function vec(weight: number): number[] {
  const v = new Array(384).fill(0.0);
  v[0] = 1; // shared base direction
  v[1] = weight; // rotates away from the source as weight grows
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

async function makePage(workspaceId: string, userId: string, title: string, weight: number) {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, contentText: title.toLowerCase(), createdBy: userId } as never)
    .returning();
  await db.insert(schema.pageEmbeddings).values({
    pageId: p!.id,
    workspaceId,
    embedding: vec(weight),
    contentHash: `h-${title}`,
  });
  return p!;
}

describe('see-also score distribution + relative score (#40/#219)', () => {
  it('orders by similarity, exposes a meaningful spread, and min-max rescales relativeScore', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const source = await makePage(workspaceId, userId, 'postgres indexing', 0); // identical direction
    const dup = await makePage(workspaceId, userId, 'postgres index tuning', 0.05); // near-duplicate
    await makePage(workspaceId, userId, 'react hooks', 0.6);
    await makePage(workspaceId, userId, 'garden tomatoes', 1.4);

    const out = await findRelatedPages(db, { pageId: source.id, viewerUserId: userId, limit: 5 });

    // (1) near-duplicate ranks first.
    expect(out[0]?.id).toBe(dup.id);

    // (2) absolute score spread across the result set exceeds a meaningful band.
    const scores = out.map((o) => o.score);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(0.05);

    // (3) relativeScore min-max rescales endpoints to [0, 1].
    expect(out[0]?.relativeScore).toBe(1);
    expect(out[out.length - 1]?.relativeScore).toBe(0);
    // monotonic: relativeScore tracks score ordering.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.relativeScore).toBeLessThanOrEqual(out[i - 1]!.relativeScore);
    }
  });
});
