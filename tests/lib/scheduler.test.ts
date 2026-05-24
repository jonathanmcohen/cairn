import { spawn } from 'node:child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startScheduler } from '@/server/scheduler';
import { startPostgres, stopPostgres } from '../helpers/db';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mockedSpawn = vi.mocked(spawn);

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  vi.useRealTimers();
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE cron_schedules RESTART IDENTITY CASCADE`;
  mockedSpawn.mockReset();
  // Default: spawn returns a child whose exit fires asynchronously with code=0.
  mockedSpawn.mockImplementation(() => {
    const child: {
      on: (event: string, cb: (code: number) => void) => typeof child;
      stdout: { on: () => typeof child };
      stderr: { on: () => typeof child };
    } = {
      on(event: string, cb: (code: number) => void) {
        if (event === 'exit') setImmediate(() => cb(0));
        return child;
      },
      stdout: { on: () => child },
      stderr: { on: () => child },
    };
    return child as unknown as ReturnType<typeof spawn>;
  });
});

describe('scheduler', () => {
  it('picks a due row and execs the CLI', async () => {
    await db.insert(schema.cronSchedules).values({
      command: 'backup --target s3 --out /tmp/b',
      cronSpec: '0 0 * * *', // nightly
      nextRunAt: new Date(Date.now() - 1000), // due now
      enabled: true,
    });
    const handle = startScheduler({ db, pollMs: 1000 });
    // Allow setImmediate + tick to flush.
    await new Promise((r) => setTimeout(r, 50));
    await handle.stop();
    expect(mockedSpawn).toHaveBeenCalledOnce();
    const call = mockedSpawn.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toBe('node');
    expect(call?.[1]).toEqual(
      expect.arrayContaining([expect.stringMatching(/cli\.js$/), 'backup']),
    );
    // last_run + last_status persisted
    const rows = await db.select().from(schema.cronSchedules);
    expect(rows[0]?.lastStatus).toBe('success');
    expect(rows[0]?.lastRunAt).toBeInstanceOf(Date);
    // next_run_at advanced beyond now (cron-parser computed the next nightly midnight)
    const nextRun = rows[0]?.nextRunAt as Date;
    expect(nextRun.getTime()).toBeGreaterThan(Date.now());
  });

  it('skips a disabled row', async () => {
    await db.insert(schema.cronSchedules).values({
      command: 'backup --target s3 --out /tmp/b',
      cronSpec: '0 0 * * *',
      nextRunAt: new Date(Date.now() - 1000),
      enabled: false,
    });
    const handle = startScheduler({ db, pollMs: 1000 });
    await new Promise((r) => setTimeout(r, 50));
    await handle.stop();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('skips a row whose next_run_at is in the future', async () => {
    await db.insert(schema.cronSchedules).values({
      command: 'backup --target s3 --out /tmp/b',
      cronSpec: '0 0 * * *',
      nextRunAt: new Date(Date.now() + 60_000),
      enabled: true,
    });
    const handle = startScheduler({ db, pollMs: 1000 });
    await new Promise((r) => setTimeout(r, 50));
    await handle.stop();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('records last_status=failure when the spawned CLI exits non-zero', async () => {
    mockedSpawn.mockImplementationOnce(() => {
      const child: {
        on: (event: string, cb: (code: number) => void) => typeof child;
        stdout: { on: () => typeof child };
        stderr: { on: () => typeof child };
      } = {
        on(event: string, cb: (code: number) => void) {
          if (event === 'exit') setImmediate(() => cb(1));
          return child;
        },
        stdout: { on: () => child },
        stderr: { on: () => child },
      };
      return child as unknown as ReturnType<typeof spawn>;
    });
    await db.insert(schema.cronSchedules).values({
      command: 'backup --out /tmp/b',
      cronSpec: '0 0 * * *',
      nextRunAt: new Date(Date.now() - 1000),
      enabled: true,
    });
    const handle = startScheduler({ db, pollMs: 1000 });
    await new Promise((r) => setTimeout(r, 50));
    await handle.stop();
    const rows = await db.select().from(schema.cronSchedules);
    expect(rows[0]?.lastStatus).toBe('failure');
    expect(rows[0]?.lastError).toMatch(/exit code 1/);
  });
});
