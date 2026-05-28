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

describe('migration 0044 — pdf_annotations', () => {
  it('creates pdf_annotations with required columns', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name='pdf_annotations'
      ORDER BY ordinal_position
    `)) as unknown as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual([
      'id',
      'page_id',
      'file_id',
      'page_number',
      'rect',
      'kind',
      'content',
      'created_by',
      'created_at',
      'updated_at',
    ]);
  });

  it('rejects invalid kind values via CHECK constraint', async () => {
    await expect(
      db.execute(drizzleSql`
        INSERT INTO pdf_annotations (id, page_id, file_id, page_number, rect, kind, created_by)
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1,
                '{"x":0,"y":0,"w":0.1,"h":0.1}'::jsonb, 'invalid', gen_random_uuid())
      `),
    ).rejects.toThrow();
  });

  it('FKs page_id/file_id/created_by all CASCADE on delete', async () => {
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
      WHERE tc.table_name = 'pdf_annotations' AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY local_column
    `)) as unknown as Array<{ local_column: string; foreign_table: string; delete_rule: string }>;
    const byCol = Object.fromEntries(fks.map((r) => [r.local_column, r]));
    expect(byCol.page_id?.foreign_table).toBe('pages');
    expect(byCol.page_id?.delete_rule).toBe('CASCADE');
    expect(byCol.file_id?.foreign_table).toBe('files');
    expect(byCol.file_id?.delete_rule).toBe('CASCADE');
    expect(byCol.created_by?.foreign_table).toBe('users');
    expect(byCol.created_by?.delete_rule).toBe('CASCADE');
  });
});
