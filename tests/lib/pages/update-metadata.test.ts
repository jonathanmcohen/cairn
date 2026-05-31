import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.CAIRN_DISABLE_EMBED_HOOK = '1';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('updatePage metadata channel', () => {
  it('merges citation prefs into pages.metadata without clobbering existing keys', async () => {
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const page = await createPage(db, { workspaceId, createdBy: userId });

    // Seed an unrelated metadata key to prove the merge preserves it.
    await db
      .update(schema.pages)
      .set({ metadata: { datetimes: [123] } })
      .where(eq(schema.pages.id, page.id));

    const updated = await updatePage(db, {
      pageId: page.id,
      workspaceId,
      patch: { metadata: { disable_bibliography: true, citation_style: 'mla' } },
      byUserId: userId,
      adminOverride: false,
    });

    const meta = updated.metadata as Record<string, unknown>;
    expect(meta.disable_bibliography).toBe(true);
    expect(meta.citation_style).toBe('mla');
    expect(meta.datetimes).toEqual([123]);
  });
});
