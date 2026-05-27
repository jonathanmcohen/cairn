import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { getPublishedPageBySlug } from '@/lib/pages/public';
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
  await sql`TRUNCATE pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seedShareable(status: schema.PageStatus): Promise<{ slug: string; pageId: string }> {
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
  const slug = `pubslug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [p] = await db
    .insert(schema.pages)
    .values({
      workspaceId: w!.id,
      title: 'Shared',
      published: true,
      publicSlug: slug,
      status,
      createdBy: u!.id,
    })
    .returning();
  return { slug, pageId: p!.id };
}

describe('public-share — v0.9.0 G4 P26 status gate', () => {
  it('returns the page when published=true AND status=published', async () => {
    const { slug } = await seedShareable('published');
    const row = await getPublishedPageBySlug(db, slug);
    expect(row).toBeTruthy();
  });

  it('returns null when status=draft even with published=true', async () => {
    const { slug } = await seedShareable('draft');
    const row = await getPublishedPageBySlug(db, slug);
    expect(row).toBeNull();
  });

  it('returns null when status=review', async () => {
    const { slug } = await seedShareable('review');
    expect(await getPublishedPageBySlug(db, slug)).toBeNull();
  });

  it('returns null when status=archived', async () => {
    const { slug } = await seedShareable('archived');
    expect(await getPublishedPageBySlug(db, slug)).toBeNull();
  });
});
