import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { BadConfigError } from '@/lib/automation/actions';
import { runSendWebhook } from '@/lib/automation/actions/send-webhook';
import { startPostgres, stopPostgres } from '../../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let otherWorkspaceId: string;
let userId: string;
let webhookId: string;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE webhook_deliveries, webhooks, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  vi.restoreAllMocks();
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
    .returning();
  if (!u) throw new Error('user insert failed');
  userId = u.id;
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('workspace insert failed');
  workspaceId = w.id;
  const [w2] = await db.insert(schema.workspaces).values({ name: 'W2', slug: 'w2' }).returning();
  if (!w2) throw new Error('workspace insert failed');
  otherWorkspaceId = w2.id;
  const [hook] = await db
    .insert(schema.webhooks)
    .values({
      workspaceId,
      url: 'https://example.test/hook',
      secret: 'cairn_whsec_test',
      events: ['row.created'],
      active: true,
    })
    .returning();
  if (!hook) throw new Error('webhook insert failed');
  webhookId = hook.id;
});

describe('runSendWebhook', () => {
  it('inserts a pending webhook_deliveries row for the configured webhookId', async () => {
    // Stub deliver() so we don't actually fetch.
    const dispatch = await import('@/lib/webhooks/dispatch');
    const spy = vi.spyOn(dispatch, 'deliver').mockResolvedValue(undefined);

    await runSendWebhook(
      { webhookId },
      { row: { id: 'r1' } },
      { ruleId: 'rule-1', workspaceId, createdBy: userId },
    );

    const rows = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, webhookId));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error('expected one delivery');
    expect(row.status).toBe('pending');
    expect(row.event).toBe('automation.fired');
    spy.mockRestore();
  });

  it('throws BadConfigError on missing webhookId', async () => {
    await expect(
      runSendWebhook({}, {}, { ruleId: 'r', workspaceId, createdBy: userId }),
    ).rejects.toThrow(BadConfigError);
  });

  it('throws when webhookId belongs to another workspace', async () => {
    const [otherHook] = await db
      .insert(schema.webhooks)
      .values({
        workspaceId: otherWorkspaceId,
        url: 'https://example.test/h2',
        secret: 'x',
        events: ['row.created'],
        active: true,
      })
      .returning();
    if (!otherHook) throw new Error('other hook insert failed');
    await expect(
      runSendWebhook(
        { webhookId: otherHook.id },
        {},
        { ruleId: 'r', workspaceId, createdBy: userId },
      ),
    ).rejects.toThrow(/not found/);
  });
});
