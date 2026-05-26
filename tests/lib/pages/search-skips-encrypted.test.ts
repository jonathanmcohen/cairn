import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { searchPages } from '@/lib/pages/search';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('searchPages — encrypted exclusion', () => {
  it('FTS branch excludes pages where encrypted=true', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [page] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'secret quarterly plan',
        createdBy: u.userId,
        contentText: 'quarterly plan details and roadmap',
      })
      .returning();
    if (!page) throw new Error('page insert failed');
    // Refresh content_tsv via the trigger.
    await sql`UPDATE pages SET content_text = 'quarterly plan details and roadmap' WHERE id = ${page.id}`;

    // Sanity — search finds it.
    const before = await searchPages(getDb(), {
      workspaceId: u.workspaceId,
      query: 'quarterly',
    });
    expect(before.map((r) => r.id)).toContain(page.id);

    // Flip encrypted; must drop from result set.
    await getDb()
      .update(schema.pages)
      .set({ encrypted: true, contentText: '' })
      .where(eq(schema.pages.id, page.id));

    const after = await searchPages(getDb(), {
      workspaceId: u.workspaceId,
      query: 'quarterly',
    });
    expect(after.map((r) => r.id)).not.toContain(page.id);
  });

  it('trigram branch excludes pages where encrypted=true (title-only fallback)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [page] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'roadmap-document',
        createdBy: u.userId,
        encrypted: true,
        contentText: '',
      })
      .returning();
    if (!page) throw new Error('page insert failed');
    // Use a typo'd query that only matches via trigram title similarity.
    const out = await searchPages(getDb(), {
      workspaceId: u.workspaceId,
      query: 'roadmapdocument', // no space → only trgm would catch
    });
    expect(out.map((r) => r.id)).not.toContain(page.id);
  });
});
