import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { embedPage } from '@/lib/search/embed-page';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, page_embeddings RESTART IDENTITY CASCADE`;
});

describe('embedPage — encrypted skip', () => {
  it('returns status=skipped-encrypted without calling the provider when page.encrypted=true', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [page] = await getDb()
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'p',
        createdBy: u.userId,
        encrypted: true,
        contentText: '',
      })
      .returning();
    if (!page) throw new Error('page insert failed');

    const result = await embedPage(getDb(), page.id);
    expect(result.status).toBe('skipped-encrypted');

    const rows = await getDb()
      .select()
      .from(schema.pageEmbeddings)
      .where(eq(schema.pageEmbeddings.pageId, page.id));
    expect(rows).toHaveLength(0);
  });
});
