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

describe('migration 0038 — mfa_webauthn', () => {
  it('creates user_webauthn_credentials with expected column shapes', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'user_webauthn_credentials'
      ORDER BY column_name;
    `)) as unknown as Array<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
    }>;
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.credential_id?.data_type).toBe('text');
    expect(byName.credential_id?.is_nullable).toBe('NO');
    expect(byName.public_key?.data_type).toBe('bytea');
    expect(byName.public_key?.is_nullable).toBe('NO');
    expect(byName.sign_count?.data_type).toBe('bigint');
    expect(byName.transports?.data_type).toBe('ARRAY');
    expect(byName.aaguid?.data_type).toBe('uuid');
    expect(byName.nickname?.is_nullable).toBe('YES');
  });

  it('enforces unique credential_id', async () => {
    const uniques = (await db.execute(drizzleSql`
      SELECT con.conname FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'user_webauthn_credentials' AND con.contype = 'u';
    `)) as unknown as Array<{ conname: string }>;
    expect(uniques.length).toBeGreaterThanOrEqual(1);
  });

  it('creates workspace_mfa_policies with require_mfa default false NOT NULL', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'workspace_mfa_policies' AND column_name = 'require_mfa';
    `)) as unknown as Array<{
      data_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data_type).toBe('boolean');
    expect(rows[0]?.is_nullable).toBe('NO');
    expect(rows[0]?.column_default).toMatch(/false/);
  });

  it("workspace_mfa_policies.methods default array contains 'totp' and 'webauthn'", async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_name = 'workspace_mfa_policies' AND column_name = 'methods';
    `)) as unknown as Array<{ column_default: string | null }>;
    expect(rows[0]?.column_default).toContain('totp');
    expect(rows[0]?.column_default).toContain('webauthn');
  });
});
