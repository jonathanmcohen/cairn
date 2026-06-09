/**
 * Schema ↔ migrations drift guard.
 *
 * `startPostgres()` applies every file in drizzle/migrations to a fresh
 * Testcontainers Postgres. This test then issues a zero-row `SELECT` of ALL
 * columns for EVERY pgTable exported from src/db/schema. If a column exists in
 * schema.ts but no migration ever creates it, Postgres raises 42703
 * (`column "x" does not exist`) and the table is reported as a failure.
 *
 * Catches the class of bug where a feature PR adds a column to the Drizzle
 * schema but forgets the migration — exactly the failure mode that was
 * *suspected* behind the v0.9.15.1 `workspaces.icon` 42703 report. (The real
 * cause there was a stale, un-migrated deployment — 0054 already creates the
 * column — but this guard is the cheap, durable insurance for the genuine
 * drift case, and runs inside the existing `db` CI matrix job.)
 */
import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { getTestDb, startPostgres, stopPostgres } from '../../helpers/db';

// Plain boolean filter + cast: a `v is PgTable` predicate trips Drizzle's
// table-type variance (literal table names vs the base `PgTable`), so narrow by
// runtime `is()` and assert the element type for iteration.
const TABLES = Object.values(schema).filter((v) => is(v, PgTable)) as unknown as PgTable[];

/** Build `SELECT "col_a", "col_b" FROM "table" LIMIT 0` from the schema columns. */
function selectAllColumnsSql(table: PgTable): string {
  const cols = Object.values(getTableColumns(table))
    .map((c) => `"${c.name}"`)
    .join(', ');
  return `SELECT ${cols} FROM "${getTableName(table)}" LIMIT 0`;
}

describe('schema ↔ migrations drift (every schema column exists in the migrated DB)', () => {
  beforeAll(startPostgres);
  afterAll(stopPostgres);

  it('exports at least one pgTable (introspection sanity)', () => {
    expect(TABLES.length).toBeGreaterThan(0);
  });

  it('every schema column resolves against the migrated DB (no 42703 drift)', async () => {
    const db = getTestDb();
    const failures: string[] = [];
    for (const table of TABLES) {
      // Names every schema-declared column explicitly; a column missing from
      // the migrated DB raises 42703. LIMIT 0 keeps it O(1) — we only care that
      // the column list resolves, not about row contents.
      try {
        await db.execute(sql.raw(selectAllColumnsSql(table)));
      } catch (err) {
        failures.push(`${getTableName(table)}: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
