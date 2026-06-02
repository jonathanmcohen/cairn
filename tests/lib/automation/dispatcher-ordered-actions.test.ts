import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { actionRunner, evaluateRules } from '@/lib/automation/dispatcher';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let userId: string;

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
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await sql`TRUNCATE automation_rule_actions, automation_runs, automation_rules, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
    .returning();
  if (!u) throw new Error('u');
  userId = u.id;
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('w');
  workspaceId = w.id;
});

describe('dispatcher ordered actions', () => {
  it('executes automation_rule_actions in sort_order', async () => {
    const order: string[] = [];
    const spy = vi.spyOn(actionRunner, 'runAction').mockImplementation(async (type) => {
      order.push(type);
    });
    const [r] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId,
        name: 'multi',
        triggerEvent: 'row.created',
        condition: {},
        actionType: 'notify',
        actionConfig: { userId },
      })
      .returning();
    if (!r) throw new Error('r');
    // Trigger backfilled one notify@0; add two more out of insertion order.
    await db.insert(schema.automationRuleActions).values([
      { ruleId: r.id, actionType: 'set_property', actionConfig: {}, sortOrder: 2 },
      { ruleId: r.id, actionType: 'send_webhook', actionConfig: {}, sortOrder: 1 },
    ]);
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });
    expect(order).toEqual(['notify', 'send_webhook', 'set_property']);
    spy.mockRestore();
  });
});
