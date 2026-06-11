import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const MIGRATION_FILE = join(process.cwd(), 'drizzle', 'migrations', '0073_oauth_token_family.sql');

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

describe('migration 0073 oauth_tokens.family_id', () => {
  it('adds family_id uuid NOT NULL DEFAULT gen_random_uuid() + family index', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_name = 'oauth_tokens' AND column_name = 'family_id'
    `)) as unknown as Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string;
    }>;
    expect(cols).toHaveLength(1);
    expect(cols[0]?.data_type).toBe('uuid');
    expect(cols[0]?.is_nullable).toBe('NO');
    expect(cols[0]?.column_default).toContain('gen_random_uuid');

    const idx = await sql`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'oauth_tokens' AND indexname = 'oauth_tokens_family_idx'
    `;
    expect(idx).toHaveLength(1);
  });

  it('rows inserted WITHOUT a family_id each get their own fresh family (column default)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const insert = (hash: string) =>
      db
        .insert(schema.oauthTokens)
        .values({
          accessTokenHash: hash,
          clientId: 'g3-default-client',
          userId: u.userId,
          workspaceId: u.workspaceId,
          scopes: ['mcp:read'],
          accessExpiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning();
    const [a] = await insert('g3-default-a');
    const [b] = await insert('g3-default-b');
    expect(a?.familyId).toBeTruthy();
    expect(b?.familyId).toBeTruthy();
    expect(a?.familyId).not.toBe(b?.familyId);
  });

  it('backfill gives every PRE-EXISTING row its OWN family (drop column, seed, re-apply)', async () => {
    // Recreate the pre-0073 world: drop the column (this also drops the
    // index), seed two rows, then re-apply the migration file. The A3 lesson:
    // unknown-lineage rows must NOT be grouped — each gets a fresh family so
    // a reuse in one can never blast the other.
    const u = await createTestWorkspaceWithUser(db);
    await sql`ALTER TABLE oauth_tokens DROP COLUMN family_id`;
    await sql`
      INSERT INTO oauth_tokens (access_token_hash, client_id, user_id, workspace_id, scopes, access_expires_at)
      VALUES
        ('g3-backfill-a', 'g3-backfill-client', ${u.userId}::uuid, ${u.workspaceId}::uuid, ${sql.array(['mcp:read'])}, now() + interval '1 hour'),
        ('g3-backfill-b', 'g3-backfill-client', ${u.userId}::uuid, ${u.workspaceId}::uuid, ${sql.array(['mcp:read'])}, now() + interval '1 hour')
    `;

    const file = readFileSync(MIGRATION_FILE, 'utf8');
    await sql.unsafe(file);

    const rows = await sql`
      SELECT family_id FROM oauth_tokens
       WHERE access_token_hash IN ('g3-backfill-a', 'g3-backfill-b')
    `;
    expect(rows).toHaveLength(2);
    const families = rows.map((r) => (r as { family_id: string | null }).family_id);
    expect(families[0]).toBeTruthy();
    expect(families[1]).toBeTruthy();
    expect(families[0]).not.toBe(families[1]);
  });

  it('re-applying the migration SQL twice is idempotent (and never re-backfills)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [seeded] = await db
      .insert(schema.oauthTokens)
      .values({
        accessTokenHash: 'g3-idempotent-a',
        clientId: 'g3-idempotent-client',
        userId: u.userId,
        workspaceId: u.workspaceId,
        scopes: ['mcp:read'],
        accessExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();

    const file = readFileSync(MIGRATION_FILE, 'utf8');
    await sql.unsafe(file);
    await sql.unsafe(file);

    // Existing rows keep their family (the backfill UPDATE matches 0 rows).
    const after = await sql`
      SELECT family_id FROM oauth_tokens WHERE access_token_hash = 'g3-idempotent-a'
    `;
    expect((after[0] as { family_id: string }).family_id).toBe(seeded?.familyId);

    const idx = await sql`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'oauth_tokens' AND indexname = 'oauth_tokens_family_idx'
    `;
    expect(idx).toHaveLength(1);
  });
});
