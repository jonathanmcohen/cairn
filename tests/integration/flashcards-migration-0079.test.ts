import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';

/**
 * Migration 0079 (v0.10.2 F3 Task A) integration tests.
 *
 * Verifies:
 *   1. `flashcard_review_events` exists with correct columns/types/nullability.
 *   2. `flashcard_review_events.card_id` FK CASCADE on card delete.
 *   3. `workspace_flashcard_settings` exists with correct columns/types.
 *   4. `workspace_flashcard_settings` defaults (newPerDay=20, reviewLimit=200, etc.).
 *   5. `workspace_flashcard_settings` upsert round-trip.
 *   6. Range rejection is tested at the lib layer (see settings.test.ts).
 */

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');
const DB_NAME = 'cairn_mig_0079';

let adminSql: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;
let tmpMigrations: string;

beforeAll(async () => {
  const uri = await startPostgres();

  adminSql = postgres(uri, { max: 1 });
  await adminSql`DROP DATABASE IF EXISTS ${adminSql(DB_NAME)} WITH (FORCE)`;
  await adminSql`CREATE DATABASE ${adminSql(DB_NAME)}`;
  const freshUri = uri.replace(/\/[^/]+$/, `/${DB_NAME}`);

  // Apply ALL migrations through 0079.
  tmpMigrations = mkdtempSync(join(tmpdir(), 'cairn-mig-0079-'));
  cpSync(MIGRATIONS_DIR, tmpMigrations, { recursive: true });

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

// ─── flashcard_review_events ────────────────────────────────────────────────

describe('migration 0079 — flashcard_review_events', () => {
  it('table exists with correct columns and types', async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'flashcard_review_events'
      ORDER BY ordinal_position
    `;
    const colMap = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // id: uuid, NOT NULL
    expect(colMap.id).toBeDefined();
    expect(colMap.id?.data_type).toBe('uuid');
    expect(colMap.id?.is_nullable).toBe('NO');

    // card_id: uuid, NOT NULL
    expect(colMap.card_id).toBeDefined();
    expect(colMap.card_id?.data_type).toBe('uuid');
    expect(colMap.card_id?.is_nullable).toBe('NO');

    // user_id: uuid, NOT NULL
    expect(colMap.user_id).toBeDefined();
    expect(colMap.user_id?.data_type).toBe('uuid');
    expect(colMap.user_id?.is_nullable).toBe('NO');

    // grade: integer, NOT NULL
    expect(colMap.grade).toBeDefined();
    expect(colMap.grade?.data_type).toBe('integer');
    expect(colMap.grade?.is_nullable).toBe('NO');

    // reviewed_at: timestamptz, NOT NULL
    expect(colMap.reviewed_at).toBeDefined();
    expect(colMap.reviewed_at?.data_type).toBe('timestamp with time zone');
    expect(colMap.reviewed_at?.is_nullable).toBe('NO');
  });

  it('indexes exist on (user_id, reviewed_at) and (card_id, user_id)', async () => {
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'flashcard_review_events'
    `;
    const names = indexes.map((r) => r.indexname);
    expect(names).toContain('flashcard_review_events_user_reviewed_at_idx');
    expect(names).toContain('flashcard_review_events_card_user_idx');
  });

  it('FK CASCADE: deleting a card deletes its review events', async () => {
    // Create workspace + user.
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (name, slug) VALUES ('FK-cascade-0079', 'fk-cascade-0079') RETURNING id
    `;
    const workspaceId = ws?.id as string;

    const [user] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, name)
      VALUES ('cascade-test-0079@example.com', 'h', 'U') RETURNING id
    `;
    const userId = user?.id as string;

    // Insert a card with NULL page_id (page_id is nullable since migration 0077).
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO flashcard_cards (page_id, workspace_id, block_id, front, back, created_by)
      VALUES (NULL, ${workspaceId}, 'b1', 'Q', 'A', ${userId}) RETURNING id
    `;
    const cardId = card?.id as string;

    // Insert a review event.
    await sql`
      INSERT INTO flashcard_review_events (card_id, user_id, grade)
      VALUES (${cardId}, ${userId}, 0)
    `;

    // Verify it exists.
    const before = await sql<{ id: string }[]>`
      SELECT id FROM flashcard_review_events WHERE card_id = ${cardId}
    `;
    expect(before).toHaveLength(1);

    // Delete the card — event should cascade-delete.
    await sql`DELETE FROM flashcard_cards WHERE id = ${cardId}`;

    const after = await sql<{ id: string }[]>`
      SELECT id FROM flashcard_review_events WHERE card_id = ${cardId}
    `;
    expect(after).toHaveLength(0);
  });
});

// ─── workspace_flashcard_settings ───────────────────────────────────────────

describe('migration 0079 — workspace_flashcard_settings', () => {
  it('table exists with correct columns, types, and defaults', async () => {
    const cols = await sql<
      {
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }[]
    >`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'workspace_flashcard_settings'
      ORDER BY ordinal_position
    `;
    const colMap = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // workspace_id: uuid, NOT NULL (PK)
    expect(colMap.workspace_id).toBeDefined();
    expect(colMap.workspace_id?.data_type).toBe('uuid');
    expect(colMap.workspace_id?.is_nullable).toBe('NO');

    // default_deck_id: uuid, NULL
    expect(colMap.default_deck_id).toBeDefined();
    expect(colMap.default_deck_id?.data_type).toBe('uuid');
    expect(colMap.default_deck_id?.is_nullable).toBe('YES');

    // new_per_day: integer, NOT NULL, default 20
    expect(colMap.new_per_day).toBeDefined();
    expect(colMap.new_per_day?.data_type).toBe('integer');
    expect(colMap.new_per_day?.is_nullable).toBe('NO');
    expect(colMap.new_per_day?.column_default).toBe('20');

    // review_limit: integer, NOT NULL, default 200
    expect(colMap.review_limit).toBeDefined();
    expect(colMap.review_limit?.data_type).toBe('integer');
    expect(colMap.review_limit?.is_nullable).toBe('NO');
    expect(colMap.review_limit?.column_default).toBe('200');

    // ease_start: real, NOT NULL, default 2.5
    expect(colMap.ease_start).toBeDefined();
    expect(colMap.ease_start?.data_type).toBe('real');
    expect(colMap.ease_start?.is_nullable).toBe('NO');

    // leech_threshold: integer, NOT NULL, default 8
    expect(colMap.leech_threshold).toBeDefined();
    expect(colMap.leech_threshold?.data_type).toBe('integer');
    expect(colMap.leech_threshold?.is_nullable).toBe('NO');
    expect(colMap.leech_threshold?.column_default).toBe('8');

    // reminder_hour: integer, NULL
    expect(colMap.reminder_hour).toBeDefined();
    expect(colMap.reminder_hour?.data_type).toBe('integer');
    expect(colMap.reminder_hour?.is_nullable).toBe('YES');
  });

  it('can insert and retrieve a settings row with custom values', async () => {
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (name, slug) VALUES ('Settings-test', 'settings-test-0079') RETURNING id
    `;
    const workspaceId = ws?.id as string;

    await sql`
      INSERT INTO workspace_flashcard_settings
        (workspace_id, new_per_day, review_limit, ease_start, leech_threshold, reminder_hour)
      VALUES
        (${workspaceId}, 30, 150, 2.2, 5, 9)
    `;

    const [row] = await sql<
      {
        new_per_day: number;
        review_limit: number;
        ease_start: number;
        leech_threshold: number;
        reminder_hour: number | null;
      }[]
    >`
      SELECT new_per_day, review_limit, ease_start, leech_threshold, reminder_hour
      FROM workspace_flashcard_settings
      WHERE workspace_id = ${workspaceId}
    `;

    expect(row?.new_per_day).toBe(30);
    expect(row?.review_limit).toBe(150);
    expect(row?.leech_threshold).toBe(5);
    expect(row?.reminder_hour).toBe(9);
  });

  it('workspace FK CASCADE: deleting workspace deletes settings row', async () => {
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (name, slug) VALUES ('Cascade-ws-0079', 'cascade-ws-0079') RETURNING id
    `;
    const workspaceId = ws?.id as string;

    await sql`
      INSERT INTO workspace_flashcard_settings (workspace_id) VALUES (${workspaceId})
    `;

    const before = await sql<{ workspace_id: string }[]>`
      SELECT workspace_id FROM workspace_flashcard_settings WHERE workspace_id = ${workspaceId}
    `;
    expect(before).toHaveLength(1);

    await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;

    const after = await sql<{ workspace_id: string }[]>`
      SELECT workspace_id FROM workspace_flashcard_settings WHERE workspace_id = ${workspaceId}
    `;
    expect(after).toHaveLength(0);
  });
});
