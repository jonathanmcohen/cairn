import { readFileSync } from 'node:fs';
import { sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { backfillDefaultPageStatusDraft } from '@/lib/pages/backfill-default-page-status';
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

describe('migration 0070 — default_page_status backfill (#37)', () => {
  it('flips workspaces still defaulting to published → draft, idempotently', async () => {
    const stamp = Date.now();
    // Simulate a pre-v0.9.9 workspace: explicitly set default_page_status to
    // 'published' (the value migration 0066 stopped writing but never cleared).
    const insertWs = async (label: string, status: 'published' | 'draft') => {
      const rows = (await db.execute(rawSql`
        INSERT INTO "workspaces" ("name", "slug", "default_page_status")
        VALUES ('m70', ${`m70-${label}-${stamp}`}, ${status})
        RETURNING "id"
      `)) as unknown as { id: string }[];
      return rows[0]!.id;
    };
    const legacyPublished = await insertWs('legacy', 'published');
    const alreadyDraft = await insertWs('draft', 'draft');

    const statusOf = async (id: string) => {
      const rows = (await db.execute(rawSql`
        SELECT "default_page_status" AS s FROM "workspaces" WHERE "id" = ${id}
      `)) as unknown as { s: string }[];
      return rows[0]!.s;
    };

    // The migration ran at startup; this twin reproduces its UPDATE so the data
    // effect is observable on rows inserted AFTER migration time.
    const changed = await backfillDefaultPageStatusDraft(db);
    expect(changed).toBeGreaterThanOrEqual(1);
    // Idempotent: a second pass touches nothing.
    expect(await backfillDefaultPageStatusDraft(db)).toBe(0);

    // The legacy 'published' workspace is now 'draft'; the already-draft one is
    // untouched (still draft, not double-processed into anything else).
    expect(await statusOf(legacyPublished)).toBe('draft');
    expect(await statusOf(alreadyDraft)).toBe('draft');
  });

  it('ships the 0070 migration with the matching UPDATE predicate', () => {
    const path = new URL(
      '../../../drizzle/migrations/0070_backfill_default_page_status_draft.sql',
      import.meta.url,
    );
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/UPDATE "workspaces"/);
    expect(text).toMatch(/SET "default_page_status" = 'draft'/);
    expect(text).toMatch(/WHERE "default_page_status" = 'published'/);
  });

  it('is registered in the drizzle journal', () => {
    const path = new URL('../../../drizzle/migrations/meta/_journal.json', import.meta.url);
    const journal = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.some((e) => e.tag === '0070_backfill_default_page_status_draft')).toBe(
      true,
    );
  });
});
