/**
 * v0.9.0 G2 P14 — `registerPageAutoUnlockCron` is the source of truth for the
 * single global `pages:auto-unlock` row in `cron_schedules`. Verifies the
 * row's shape (no workspace_id, every-5-minutes spec, enabled), idempotency,
 * and re-enablement.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerPageAutoUnlockCron } from '@/server/cron-register';
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

describe('registerPageAutoUnlockCron', () => {
  it('inserts a single global row (workspace_id IS NULL) with the */5 spec', async () => {
    await registerPageAutoUnlockCron(db);
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(
        and(
          isNull(schema.cronSchedules.workspaceId),
          eq(schema.cronSchedules.command, 'pages:auto-unlock'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cronSpec).toBe('*/5 * * * *');
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.workspaceId).toBeNull();
    expect(rows[0]?.nextRunAt).toBeInstanceOf(Date);
    expect((rows[0]?.nextRunAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('is idempotent — second call updates rather than duplicates', async () => {
    await registerPageAutoUnlockCron(db);
    await registerPageAutoUnlockCron(db);
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.command, 'pages:auto-unlock'));
    expect(rows).toHaveLength(1);
  });

  it('re-enables a previously disabled row on re-register', async () => {
    await registerPageAutoUnlockCron(db);
    await db
      .update(schema.cronSchedules)
      .set({ enabled: false })
      .where(eq(schema.cronSchedules.command, 'pages:auto-unlock'));
    await registerPageAutoUnlockCron(db);
    const [row] = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.command, 'pages:auto-unlock'));
    expect(row?.enabled).toBe(true);
  });
});
