import { spawn } from 'node:child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { SCHEDULER_ADVISORY_LOCK_KEY, startScheduler } from '@/server/scheduler';

import { startPostgres, stopPostgres } from '../helpers/db';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

let uri: string;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mockedSpawn = vi.mocked(spawn);

// A private lock key so this file never contends with the real scheduler key
// or with other test files running in parallel against the shared container.
const TEST_LOCK_KEY = 918_273_645;

beforeAll(async () => {
  uri = await startPostgres();
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
  mockedSpawn.mockReset();
  mockedSpawn.mockImplementation(() => {
    const child: {
      on: (event: string, cb: (code: number) => void) => typeof child;
    } = {
      on(event: string, cb: (code: number) => void) {
        if (event === 'exit') setImmediate(() => cb(0));
        return child;
      },
    };
    return child as unknown as ReturnType<typeof spawn>;
  });
});

async function seedDue(): Promise<void> {
  await db.insert(schema.cronSchedules).values({
    command: 'trash:purge',
    cronSpec: '0 0 * * *',
    nextRunAt: new Date(Date.now() - 1000),
    enabled: true,
  });
}

describe('scheduler advisory lock (single-runner election)', () => {
  it('uses a key distinct from the migrations lock', () => {
    // 4021966011 is the migrations lock; ours must differ.
    expect(SCHEDULER_ADVISORY_LOCK_KEY).not.toBe(4021966011);
  });

  it('skips the tick when another session already holds the lock', async () => {
    await seedDue();

    // Simulate a second instance holding the lock on its own connection.
    const holder = postgres(uri, { max: 1 });
    try {
      const [held] = await holder<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_lock(${TEST_LOCK_KEY}) AS locked`;
      expect(held?.locked).toBe(true);

      const handle = startScheduler({
        db,
        pollMs: 10_000,
        lockConnectionString: uri,
        lockKey: TEST_LOCK_KEY,
      });
      // Let the immediate tick attempt + fail to acquire.
      await new Promise((r) => setTimeout(r, 80));
      await handle.stop();

      // Lock was contended → no CLI spawned, row left due (untouched).
      expect(mockedSpawn).not.toHaveBeenCalled();
      const rows = await db.select().from(schema.cronSchedules);
      expect(rows[0]?.lastStatus).toBeNull();
    } finally {
      await holder`SELECT pg_advisory_unlock(${TEST_LOCK_KEY})`.catch(() => {});
      await holder.end();
    }
  });

  it('acquires the lock, processes the tick, then releases it', async () => {
    await seedDue();

    const handle = startScheduler({
      db,
      pollMs: 10_000,
      lockConnectionString: uri,
      lockKey: TEST_LOCK_KEY,
    });
    await new Promise((r) => setTimeout(r, 80));
    await handle.stop();

    // The tick ran (lock acquired) — the row was processed.
    expect(mockedSpawn).toHaveBeenCalledOnce();
    const rows = await db.select().from(schema.cronSchedules);
    expect(rows[0]?.lastStatus).toBe('success');

    // The lock was released after the tick: a fresh session can re-acquire it.
    const checker = postgres(uri, { max: 1 });
    try {
      const [reacquired] = await checker<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_lock(${TEST_LOCK_KEY}) AS locked`;
      expect(reacquired?.locked).toBe(true);
    } finally {
      await checker`SELECT pg_advisory_unlock(${TEST_LOCK_KEY})`.catch(() => {});
      await checker.end();
    }
  });

  it('fails OPEN: an unreachable lock connection still runs the tick (single-instance)', async () => {
    await seedDue();

    // Lock connection points at a refused port (mirrors CI where the existing
    // scheduler test's DATABASE_URL resolves to a non-listening localhost). The
    // tick must degrade to single-instance behaviour and still process the row,
    // NOT silently abort.
    const handle = startScheduler({
      db,
      pollMs: 10_000,
      lockConnectionString: 'postgres://cairn:cairn@127.0.0.1:1/cairn',
      lockKey: TEST_LOCK_KEY,
    });
    await new Promise((r) => setTimeout(r, 120));
    await handle.stop();

    expect(mockedSpawn).toHaveBeenCalledOnce();
    const rows = await db.select().from(schema.cronSchedules);
    expect(rows[0]?.lastStatus).toBe('success');
  });

  it('two concurrent schedulers do not double-process a due row', async () => {
    await seedDue();

    // Both share the same DB + lock key (mimicking two app instances).
    const a = startScheduler({
      db,
      pollMs: 10_000,
      lockConnectionString: uri,
      lockKey: TEST_LOCK_KEY,
    });
    const b = startScheduler({
      db,
      pollMs: 10_000,
      lockConnectionString: uri,
      lockKey: TEST_LOCK_KEY,
    });
    await new Promise((r) => setTimeout(r, 120));
    await Promise.all([a.stop(), b.stop()]);

    // Exactly one of the two instances won the lock and ran the single due row.
    expect(mockedSpawn).toHaveBeenCalledOnce();
    const rows = await db.select().from(schema.cronSchedules);
    expect(rows[0]?.lastStatus).toBe('success');
  });
});
