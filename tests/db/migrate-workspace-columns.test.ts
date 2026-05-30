import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

/**
 * Regression guard for the v0.9.4 homelab outage (hotfix v0.9.5).
 *
 * `workspaces.icon` (migration 0054) exists and the runner applies it on a
 * fresh DB — but the homelab container ran `runMigrations` with a cwd-relative
 * `./drizzle/migrations` path from a directory that wasn't the image WORKDIR,
 * so drizzle found zero pending migrations, "succeeded", and never created the
 * column. Every workspace fetch then threw `column "icon" does not exist`
 * (42703) because the Drizzle select projects the full `workspaces` row.
 *
 * This test reproduces BOTH halves:
 *  1. it runs `runMigrations` from a NON-repo cwd (tmpdir) — the old
 *     cwd-relative path would silently no-op here; the absolute-path fix must
 *     still apply 0054.
 *  2. it then runs the exact failing query shape (full-row workspace select,
 *     every schema column incl. `icon`) and asserts it does not throw.
 */

let uri = '';
let originalCwd = '';

beforeAll(async () => {
  uri = await startPostgres();
});

afterAll(async () => {
  await stopPostgres();
});

it('applies workspaces.icon even when migrations run from a non-repo cwd', async () => {
  // Reproduce the homelab condition: process cwd is NOT the repo/app root, so a
  // cwd-relative migrations folder would resolve to nothing.
  originalCwd = process.cwd();
  try {
    process.chdir(tmpdir());
    await runMigrations(uri);
  } finally {
    process.chdir(originalCwd);
  }

  const sql = postgres(uri);
  try {
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workspaces'
    `;
    const names = cols.map((c) => c.column_name);
    // The column the homelab was missing, plus the other v0.9.x columns the
    // failing select projected.
    expect(names).toEqual(
      expect.arrayContaining([
        'icon',
        'e2e_mode',
        'trash_retention_days',
        'default_page_status',
        'enable_federated_search',
      ]),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
});

it('selects a full workspace row (all columns, incl. icon) without a missing-column error', async () => {
  const sql = postgres(uri);
  try {
    const db = drizzle(sql, { schema });
    const id = randomUUID();
    // Insert a minimal workspace (NOT NULL columns carry schema defaults).
    await sql`INSERT INTO workspaces (id, name, slug) VALUES (${id}, ${'Hotfix WS'}, ${`hotfix-${id.slice(0, 8)}`})`;

    // Exact shape of the failing production query: full-row select over every
    // mapped column, including `icon`. Throws 42703 if any column is absent.
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    expect(ws).toBeDefined();
    expect(ws?.id).toBe(id);
    // `icon` is nullable and unset → null, but must be a *present* selectable column.
    expect(ws ? 'icon' in ws : false).toBe(true);
    expect(ws?.icon ?? null).toBeNull();
  } finally {
    await sql.end({ timeout: 5 });
  }
});
