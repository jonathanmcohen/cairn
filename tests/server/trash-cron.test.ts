import { sql as drizzleSql, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerTrashPurgeCron } from '@/server/cron-register';
import { startPostgres, stopPostgres } from '../helpers/db';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE cron_schedules, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seedWorkspace(): Promise<string> {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = (await getDb().execute(drizzleSql`
    INSERT INTO workspaces (name, slug) VALUES ('w', ${`w-${ts}`}) RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('registerTrashPurgeCron', () => {
  it('inserts a cron_schedules row with the trash:purge command + daily 03:00 cron', async () => {
    const wsId = await seedWorkspace();
    await registerTrashPurgeCron(getDb(), { workspaceId: wsId });
    const rows = await getDb()
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.workspaceId, wsId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toBe(`trash:purge --workspace-id=${wsId}`);
    expect(rows[0]?.cronSpec).toBe('0 3 * * *');
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.nextRunAt).toBeInstanceOf(Date);
    expect((rows[0]?.nextRunAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('is idempotent — second call updates rather than duplicates', async () => {
    const wsId = await seedWorkspace();
    await registerTrashPurgeCron(getDb(), { workspaceId: wsId });
    await registerTrashPurgeCron(getDb(), { workspaceId: wsId });
    const rows = await getDb()
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.workspaceId, wsId));
    expect(rows).toHaveLength(1);
  });

  it('re-enables a previously disabled row on re-register', async () => {
    const wsId = await seedWorkspace();
    await registerTrashPurgeCron(getDb(), { workspaceId: wsId });
    await getDb()
      .update(schema.cronSchedules)
      .set({ enabled: false })
      .where(eq(schema.cronSchedules.workspaceId, wsId));
    await registerTrashPurgeCron(getDb(), { workspaceId: wsId });
    const rows = await getDb()
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.workspaceId, wsId));
    expect(rows[0]?.enabled).toBe(true);
  });
});

describe('createWorkspace wires up the trash:purge cron row', () => {
  it('a workspace created via createWorkspace immediately has a trash:purge schedule', async () => {
    const db = getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [u] = await db
      .insert(schema.users)
      .values({ email: `u${ts}@x.test`, passwordHash: 'h', name: 'u' })
      .returning();
    if (!u) throw new Error('user');
    const { createWorkspace } = await import('@/lib/workspaces/create');
    const ws = await createWorkspace(db, { name: 'Trashy', ownerUserId: u.id });
    const rows = await db
      .select()
      .from(schema.cronSchedules)
      .where(eq(schema.cronSchedules.workspaceId, ws.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toBe(`trash:purge --workspace-id=${ws.id}`);
  });
});
