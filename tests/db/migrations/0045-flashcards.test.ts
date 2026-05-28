import { sql as drizzleSql } from 'drizzle-orm';
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

describe('migration 0045 — flashcards', () => {
  it('creates flashcard_cards with required columns', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name='flashcard_cards'
      ORDER BY ordinal_position
    `)) as unknown as Array<{ column_name: string }>;
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'page_id',
      'workspace_id',
      'block_id',
      'front',
      'back',
      'deck_tag',
      'created_by',
      'created_at',
      'updated_at',
    ]);
  });

  it('creates flashcard_reviews with composite primary key (card_id, user_id)', async () => {
    const pk = (await db.execute(drizzleSql`
      SELECT a.attname AS col FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'flashcard_reviews'::regclass AND i.indisprimary
      ORDER BY a.attnum
    `)) as unknown as Array<{ col: string }>;
    expect(pk.map((r) => r.col)).toEqual(['card_id', 'user_id']);
  });

  it('flashcard_reviews has expected scheduling columns', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='flashcard_reviews'
      ORDER BY ordinal_position
    `)) as unknown as Array<{ column_name: string }>;
    const names = rows.map((r) => r.column_name);
    expect(names).toContain('ease');
    expect(names).toContain('interval');
    expect(names).toContain('due_at');
    expect(names).toContain('last_reviewed_at');
    expect(names).toContain('last_grade');
  });

  it('cards FKs page_id/workspace_id/created_by all CASCADE on delete', async () => {
    const fks = (await db.execute(drizzleSql`
      SELECT kcu.column_name AS local_column,
             ccu.table_name AS foreign_table,
             rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
       AND rc.constraint_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.table_schema
      WHERE tc.table_name = 'flashcard_cards' AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY local_column
    `)) as unknown as Array<{ local_column: string; foreign_table: string; delete_rule: string }>;
    const byCol = Object.fromEntries(fks.map((r) => [r.local_column, r]));
    expect(byCol.page_id?.delete_rule).toBe('CASCADE');
    expect(byCol.workspace_id?.delete_rule).toBe('CASCADE');
    expect(byCol.created_by?.delete_rule).toBe('CASCADE');
  });

  it('reviews FKs card_id/user_id both CASCADE on delete', async () => {
    const fks = (await db.execute(drizzleSql`
      SELECT kcu.column_name AS local_column, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'flashcard_reviews' AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY local_column
    `)) as unknown as Array<{ local_column: string; delete_rule: string }>;
    const byCol = Object.fromEntries(fks.map((r) => [r.local_column, r]));
    expect(byCol.card_id?.delete_rule).toBe('CASCADE');
    expect(byCol.user_id?.delete_rule).toBe('CASCADE');
  });
});
