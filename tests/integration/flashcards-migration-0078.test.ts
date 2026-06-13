import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { createWorkspace } from '@/lib/workspaces/create';
import { startPostgres, stopPostgres } from '../helpers/db';

/**
 * Migration 0078 (v0.10.2 F2 Task A) integration tests.
 *
 * Verifies:
 *   1. All 6 new columns exist on flashcard_decks with the right data types.
 *   2. parent_deck_id self-FK: delete parent → child's parent_deck_id SET NULL.
 *   3. createWorkspace seeds exactly one "Default" deck for the new workspace.
 *
 * Uses a separate DB on the shared Testcontainers container (identical to the
 * 0077 test approach) so it can apply migrations from scratch.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');
const DB_NAME = 'cairn_mig_0078';

let adminSql: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;
let tmpMigrations: string;

beforeAll(async () => {
  const uri = await startPostgres();

  // Create a fresh DB on the shared container.
  adminSql = postgres(uri, { max: 1 });
  await adminSql`DROP DATABASE IF EXISTS ${adminSql(DB_NAME)} WITH (FORCE)`;
  await adminSql`CREATE DATABASE ${adminSql(DB_NAME)}`;
  const freshUri = uri.replace(/\/[^/]+$/, `/${DB_NAME}`);

  // Build a temp migrations folder containing ALL migrations through 0078
  // (including 0078 itself) so the migrator applies the new DDL.
  tmpMigrations = mkdtempSync(join(tmpdir(), 'cairn-mig-0078-'));
  cpSync(MIGRATIONS_DIR, tmpMigrations, { recursive: true });

  // No journal truncation needed — apply every migration including 0078.
  const migrateSql = postgres(freshUri, { max: 1 });
  await migrate(drizzle(migrateSql), { migrationsFolder: tmpMigrations });
  await migrateSql.end();

  sql = postgres(freshUri);
}, 120_000);

afterAll(async () => {
  if (sql) await sql.end();
  if (tmpMigrations) rmSync(tmpMigrations, { recursive: true, force: true });
  if (adminSql) {
    await adminSql`DROP DATABASE IF EXISTS ${adminSql(DB_NAME)} WITH (FORCE)`;
    await adminSql.end();
  }
  await stopPostgres();
});

describe('migration 0078 — flashcard_decks full schema', () => {
  it('adds all 6 new columns with correct data types', async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'flashcard_decks'
      ORDER BY ordinal_position
    `;
    const colMap = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // icon: text, nullable
    expect(colMap.icon).toBeDefined();
    expect(colMap.icon?.data_type).toBe('text');
    expect(colMap.icon?.is_nullable).toBe('YES');

    // color: text, nullable
    expect(colMap.color).toBeDefined();
    expect(colMap.color?.data_type).toBe('text');
    expect(colMap.color?.is_nullable).toBe('YES');

    // parent_deck_id: uuid, nullable
    expect(colMap.parent_deck_id).toBeDefined();
    expect(colMap.parent_deck_id?.data_type).toBe('uuid');
    expect(colMap.parent_deck_id?.is_nullable).toBe('YES');

    // default_new_per_day: integer, nullable
    expect(colMap.default_new_per_day).toBeDefined();
    expect(colMap.default_new_per_day?.data_type).toBe('integer');
    expect(colMap.default_new_per_day?.is_nullable).toBe('YES');

    // default_review_limit: integer, nullable
    expect(colMap.default_review_limit).toBeDefined();
    expect(colMap.default_review_limit?.data_type).toBe('integer');
    expect(colMap.default_review_limit?.is_nullable).toBe('YES');

    // ease_start: real (information_schema reports it as "real"), nullable
    expect(colMap.ease_start).toBeDefined();
    expect(colMap.ease_start?.data_type).toBe('real');
    expect(colMap.ease_start?.is_nullable).toBe('YES');
  });

  it('parent_deck_id self-FK ON DELETE SET NULL: deleting parent nulls child', async () => {
    // Insert a workspace for isolation.
    const wsRows = await sql<{ id: string }[]>`
      INSERT INTO workspaces (name, slug) VALUES ('FK-test', 'fk-test-0078') RETURNING id
    `;
    const workspaceId = wsRows[0]?.id as string;

    // Parent deck.
    const parentRows = await sql<{ id: string }[]>`
      INSERT INTO flashcard_decks (workspace_id, name)
      VALUES (${workspaceId}, 'Parent') RETURNING id
    `;
    const parentId = parentRows[0]?.id as string;

    // Child deck referencing parent.
    const childRows = await sql<{ id: string }[]>`
      INSERT INTO flashcard_decks (workspace_id, name, parent_deck_id)
      VALUES (${workspaceId}, 'Child', ${parentId}) RETURNING id
    `;
    const childId = childRows[0]?.id as string;

    // Verify child.parent_deck_id is set.
    const beforeRows = await sql<{ parent_deck_id: string | null }[]>`
      SELECT parent_deck_id FROM flashcard_decks WHERE id = ${childId}
    `;
    expect(beforeRows[0]?.parent_deck_id).toBe(parentId);

    // Delete the parent — FK ON DELETE SET NULL should null the child's reference.
    await sql`DELETE FROM flashcard_decks WHERE id = ${parentId}`;

    const afterRows = await sql<{ parent_deck_id: string | null }[]>`
      SELECT parent_deck_id FROM flashcard_decks WHERE id = ${childId}
    `;
    expect(afterRows[0]).toBeDefined();
    expect(afterRows[0]?.parent_deck_id).toBeNull();
  });

  it('createWorkspace seeds exactly one Default deck for the new workspace', async () => {
    // Build a Drizzle db handle connected to the 0078 DB for createWorkspace.
    const freshUri = (await startPostgres()).replace(/\/[^/]+$/, `/${DB_NAME}`);
    const dbSql = postgres(freshUri);
    const db = drizzle(dbSql, { schema });

    // We need a user row for the owner FK.
    const userRows = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, name)
      VALUES ('create-ws-test@example.com', 'h', 'U') RETURNING id
    `;
    const ownerUserId = userRows[0]?.id as string;

    const ws = await createWorkspace(db, { name: 'Deck-seed WS', ownerUserId });

    const decks = await sql<{ name: string }[]>`
      SELECT name FROM flashcard_decks WHERE workspace_id = ${ws.id}
    `;
    expect(decks).toHaveLength(1);
    expect(decks[0]?.name).toBe('Default');

    await dbSql.end();
  });
});
