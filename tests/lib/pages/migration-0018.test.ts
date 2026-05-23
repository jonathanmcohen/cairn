import { sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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

describe('migration 0018', () => {
  it('creates the page_link_kind enum with link/mention/embed', async () => {
    const rows = (await db.execute(rawSql`
      SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'page_link_kind'
    `)) as unknown as { label: string }[];
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(['link', 'mention', 'embed']));
  });
  it('creates page_links with a composite PK and a target_page_id index', async () => {
    const cols = (await db.execute(rawSql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'page_links'
    `)) as unknown as { column_name: string }[];
    expect(cols.map((c) => c.column_name)).toEqual(
      expect.arrayContaining(['source_page_id', 'target_page_id', 'kind']),
    );
    const idx = (await db.execute(rawSql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'page_links' AND indexdef ILIKE '%target_page_id%'
    `)) as unknown as { indexname: string }[];
    expect(idx.length).toBeGreaterThanOrEqual(1);
  });
  it('page_links FKs cascade on page delete', async () => {
    const rows = (await db.execute(rawSql`
      SELECT rc.delete_rule, kcu.column_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
      WHERE kcu.table_name = 'page_links'
    `)) as unknown as { delete_rule: string; column_name: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.delete_rule).toBe('CASCADE');
  });
  it('creates notification_email_prefs with its composite PK columns (for P11)', async () => {
    const cols = (await db.execute(rawSql`
      SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'notification_email_prefs'
    `)) as unknown as { column_name: string; data_type: string }[];
    const byName = new Map(cols.map((c) => [c.column_name, c.data_type]));
    expect([...byName.keys()]).toEqual(
      expect.arrayContaining([
        'user_id',
        'workspace_id',
        'notification_type',
        'email_enabled',
        'digest_only',
      ]),
    );
    expect(byName.get('email_enabled')).toBe('boolean');
    expect(byName.get('digest_only')).toBe('boolean');
  });
});
