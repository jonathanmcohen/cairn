import { readFileSync } from 'node:fs';
import { sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { backfillLegacyOrangeCovers } from '@/lib/pages/backfill-legacy-cover';
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

describe('migration 0068 — legacy orange cover backfill (#214)', () => {
  it('reassigns #ea580c / #d97706 color covers to slate-dusk and leaves others untouched', async () => {
    const stamp = Date.now();
    const wsRows = (await db.execute(rawSql`
      INSERT INTO "workspaces" ("name", "slug") VALUES ('m6', ${`m6-${stamp}`})
      RETURNING "id"
    `)) as unknown as { id: string }[];
    const workspaceId = wsRows[0]!.id;
    const userRows = (await db.execute(rawSql`
      INSERT INTO "users" ("email", "password_hash", "name")
      VALUES (${`m6-${stamp}@example.com`}, 'x', 'M6')
      RETURNING "id"
    `)) as unknown as { id: string }[];
    const userId = userRows[0]!.id;

    const insertPage = async (cover: string) => {
      const rows = (await db.execute(rawSql`
        INSERT INTO "pages" ("workspace_id", "title", "cover", "created_by")
        VALUES (${workspaceId}, 'p', ${cover}::jsonb, ${userId}) RETURNING "id"
      `)) as unknown as { id: string }[];
      return rows[0]!.id;
    };
    const orange = await insertPage('{"kind":"color","value":"#ea580c"}');
    const amberUpper = await insertPage('{"kind":"color","value":"#D97706"}');
    const blue = await insertPage('{"kind":"color","value":"#3366ff"}');
    const preset = await insertPage('{"kind":"preset","value":"ember-mute"}');

    // Apply the migration's UPDATE via its imperative twin. Idempotent — a
    // second call is a no-op.
    const changed = await backfillLegacyOrangeCovers(db);
    expect(changed).toBe(2);
    expect(await backfillLegacyOrangeCovers(db)).toBe(0);

    const coverOf = async (id: string) => {
      const rows = (await db.execute(rawSql`
        SELECT "cover" FROM "pages" WHERE "id" = ${id}
      `)) as unknown as { cover: unknown }[];
      return rows[0]!.cover;
    };
    // Legacy oranges → slate-dusk preset (lowercase + uppercase both caught).
    expect(await coverOf(orange)).toEqual({ kind: 'preset', value: 'slate-dusk' });
    expect(await coverOf(amberUpper)).toEqual({ kind: 'preset', value: 'slate-dusk' });
    // Untouched: other color + already-curated preset.
    expect(await coverOf(blue)).toEqual({ kind: 'color', value: '#3366ff' });
    expect(await coverOf(preset)).toEqual({ kind: 'preset', value: 'ember-mute' });
  });

  it('ships the 0068 migration with the matching predicate', () => {
    const path = new URL(
      '../../../drizzle/migrations/0068_backfill_legacy_orange_covers.sql',
      import.meta.url,
    );
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/UPDATE "pages"/);
    expect(text).toMatch(/'#ea580c'/);
    expect(text).toMatch(/'#d97706'/);
    expect(text).toMatch(/"kind":"preset","value":"slate-dusk"/);
  });
});
