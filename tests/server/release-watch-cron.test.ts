/**
 * v0.9.0 G8 P42 — `registerReleaseWatchTickCron` is the source of truth for
 * the single global `release-watch:tick` row in `cron_schedules`. Verifies
 * row shape (no workspace_id, daily-04:30 spec, enabled), idempotency, and
 * re-enable.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerReleaseWatchTickCron } from '@/server/cron-register';
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
  await sql`TRUNCATE cron_schedules RESTART IDENTITY CASCADE`;
});

describe('registerReleaseWatchTickCron', () => {
  it('inserts a single global row (workspace_id IS NULL) with the daily-04:30 spec', async () => {
    await registerReleaseWatchTickCron(db);
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(
        and(
          isNull(schema.cronSchedules.workspaceId),
          eq(schema.cronSchedules.command, 'release-watch:tick'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cronSpec).toBe('30 4 * * *');
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.workspaceId).toBeNull();
    expect(rows[0]?.nextRunAt).toBeInstanceOf(Date);
  });

  it('is idempotent — second call updates rather than duplicates', async () => {
    await registerReleaseWatchTickCron(db);
    await registerReleaseWatchTickCron(db);
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.command, 'release-watch:tick'));
    expect(rows).toHaveLength(1);
  });

  it('re-enables a previously-disabled row', async () => {
    await registerReleaseWatchTickCron(db);
    await db
      .update(schema.cronSchedules)
      .set({ enabled: false })
      .where(eq(schema.cronSchedules.command, 'release-watch:tick'));
    await registerReleaseWatchTickCron(db);
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.command, 'release-watch:tick'));
    expect(rows[0]?.enabled).toBe(true);
  });
});
