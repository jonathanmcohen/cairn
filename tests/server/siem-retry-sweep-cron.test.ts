/**
 * v0.9.0 G8 P39 — `registerSiemRetrySweepCron` is the source of truth for the
 * single global `siem:retry-sweep` row in `cron_schedules`. Verifies row shape
 * (no workspace_id, every-minute spec, enabled), idempotency, and re-enable.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerSiemRetrySweepCron } from '@/server/cron-register';
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

describe('registerSiemRetrySweepCron', () => {
  it('inserts a single global row (workspace_id IS NULL) with the every-minute spec', async () => {
    await registerSiemRetrySweepCron(db);
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(
        and(
          isNull(schema.cronSchedules.workspaceId),
          eq(schema.cronSchedules.command, 'siem:retry-sweep'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cronSpec).toBe('* * * * *');
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.workspaceId).toBeNull();
    expect(rows[0]?.nextRunAt).toBeInstanceOf(Date);
  });

  it('is idempotent — second call updates rather than duplicates', async () => {
    await registerSiemRetrySweepCron(db);
    await registerSiemRetrySweepCron(db);
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.command, 'siem:retry-sweep'));
    expect(rows).toHaveLength(1);
  });

  it('re-enables a previously disabled row on re-register', async () => {
    await registerSiemRetrySweepCron(db);
    await db
      .update(schema.cronSchedules)
      .set({ enabled: false })
      .where(eq(schema.cronSchedules.command, 'siem:retry-sweep'));
    await registerSiemRetrySweepCron(db);
    const [row] = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.command, 'siem:retry-sweep'));
    expect(row?.enabled).toBe(true);
  });
});
