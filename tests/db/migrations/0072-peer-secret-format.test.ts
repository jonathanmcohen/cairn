import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('migration 0072 peer_instances.secret_format', () => {
  it('adds secret_format text NOT NULL DEFAULT raw', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_name = 'peer_instances' AND column_name = 'secret_format'
    `)) as unknown as Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string;
    }>;
    expect(cols).toHaveLength(1);
    expect(cols[0]?.data_type).toBe('text');
    expect(cols[0]?.is_nullable).toBe('NO');
    expect(cols[0]?.column_default).toContain('raw');
  });

  it('CHECK-constrains secret_format to raw | enc-v1', async () => {
    const constraint = (await db.execute(drizzleSql`
      SELECT conname FROM pg_constraint
       WHERE conname = 'peer_instances_secret_format_check'
    `)) as unknown as Array<{ conname: string }>;
    expect(constraint).toHaveLength(1);
    await expect(
      sql`
        INSERT INTO peer_instances (workspace_id, name, base_url, shared_secret_hash, secret_format)
        VALUES (gen_random_uuid(), 'bad-format', 'http://x', 's', 'not-a-format')
      `,
    ).rejects.toThrow(/peer_instances_secret_format_check|violates/i);
  });

  it('re-applying the migration SQL is idempotent (IF NOT EXISTS + pg_constraint guard)', async () => {
    const file = readFileSync(
      join(process.cwd(), 'drizzle', 'migrations', '0072_peer_secret_format.sql'),
      'utf8',
    );
    // The migration already ran via runMigrations in beforeAll — applying the
    // raw file content again (twice, for good measure) must not error.
    await sql.unsafe(file);
    await sql.unsafe(file);
    const constraint = await sql`
      SELECT conname FROM pg_constraint WHERE conname = 'peer_instances_secret_format_check'
    `;
    expect(constraint).toHaveLength(1);
  });
});
