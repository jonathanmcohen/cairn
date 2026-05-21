import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

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
  await sql`TRUNCATE system_meta RESTART IDENTITY`;
});

describe('system_meta schema + pg_trgm extension', () => {
  it('can upsert a key/value', async () => {
    await db.insert(schema.systemMeta).values({ key: 'last_purge_at', value: 'never' });
    const [row] = await db.select().from(schema.systemMeta);
    expect(row?.key).toBe('last_purge_at');
    expect(row?.value).toBe('never');
  });

  it('pg_trgm extension is installed', async () => {
    const rows = await sql<
      { extname: string }[]
    >`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
    expect(rows).toHaveLength(1);
  });

  it('trigram index on pages.title exists', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'pages' AND indexname = 'pages_title_trgm_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});
