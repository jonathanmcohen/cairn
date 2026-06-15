import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  InvalidCronError,
  listSchedules,
  nextRunFromCron,
  runScheduleNow,
  updateSchedule,
} from '@/lib/scheduler/manage';
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

beforeEach(async () => {
  await sql`TRUNCATE cron_schedules RESTART IDENTITY CASCADE`;
});

async function seed(overrides: Partial<schema.NewCronSchedule> = {}): Promise<string> {
  const [row] = await db
    .insert(schema.cronSchedules)
    .values({
      command: 'trash:purge',
      cronSpec: '0 3 * * *',
      nextRunAt: new Date(Date.now() + 3_600_000),
      enabled: true,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row.id;
}

describe('scheduler/manage', () => {
  it('lists all rows ordered by command', async () => {
    await seed({ command: 'siem:retry-sweep', cronSpec: '* * * * *' });
    await seed({ command: 'pages:auto-unlock', cronSpec: '*/5 * * * *' });
    await seed({ command: 'trash:purge' });

    const rows = await listSchedules(db);
    expect(rows.map((r) => r.command)).toEqual([
      'pages:auto-unlock',
      'siem:retry-sweep',
      'trash:purge',
    ]);
    // ISO-string shape (not Date), nullable last-run fields surfaced.
    expect(typeof rows[0]?.nextRunAt).toBe('string');
    expect(rows[0]?.lastRunAt).toBeNull();
    expect(rows[0]?.enabled).toBe(true);
  });

  it('updating cronSpec recomputes nextRunAt from the new expression', async () => {
    const id = await seed({ cronSpec: '0 3 * * *' });
    const updated = await updateSchedule(db, id, { cronSpec: '*/5 * * * *' });
    expect(updated?.cronSpec).toBe('*/5 * * * *');
    // Next */5 fire is within ~5 minutes of now, well before the old 03:00 slot.
    const next = new Date(updated?.nextRunAt ?? 0).getTime();
    expect(next).toBeGreaterThan(Date.now() - 1000);
    expect(next).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
  });

  it('rejects an invalid cron expression and writes nothing', async () => {
    const id = await seed({ cronSpec: '0 3 * * *' });
    await expect(updateSchedule(db, id, { cronSpec: 'not a cron' })).rejects.toBeInstanceOf(
      InvalidCronError,
    );
    // The cron expr is untouched after the rejected update.
    const after = await listSchedules(db);
    expect(after[0]?.cronSpec).toBe('0 3 * * *');
  });

  it('enables and disables a schedule', async () => {
    const id = await seed({ enabled: true });
    const off = await updateSchedule(db, id, { enabled: false });
    expect(off?.enabled).toBe(false);
    const on = await updateSchedule(db, id, { enabled: true });
    expect(on?.enabled).toBe(true);
  });

  it('no-field update is idempotent and returns the row unchanged', async () => {
    const id = await seed({ cronSpec: '0 3 * * *' });
    const before = await listSchedules(db);
    const same = await updateSchedule(db, id, {});
    expect(same?.cronSpec).toBe('0 3 * * *');
    expect(same?.nextRunAt).toBe(before[0]?.nextRunAt);
  });

  it('updateSchedule returns null for an unknown id', async () => {
    const result = await updateSchedule(db, '00000000-0000-0000-0000-000000000000', {
      enabled: false,
    });
    expect(result).toBeNull();
  });

  it('runScheduleNow sets nextRunAt to approximately now', async () => {
    const id = await seed({ nextRunAt: new Date(Date.now() + 86_400_000) });
    const before = Date.now();
    const ran = await runScheduleNow(db, id);
    const after = Date.now();
    expect(ran).not.toBeNull();
    const next = new Date(ran?.nextRunAt ?? 0).getTime();
    expect(next).toBeGreaterThanOrEqual(before - 1000);
    expect(next).toBeLessThanOrEqual(after + 1000);
  });

  it('runScheduleNow returns null for an unknown id', async () => {
    const result = await runScheduleNow(db, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('nextRunFromCron throws InvalidCronError on garbage', () => {
    expect(() => nextRunFromCron('definitely not cron')).toThrow(InvalidCronError);
  });
});
