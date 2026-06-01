import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

describe('automation schema additions', () => {
  it('automation_rules exposes a conditionTree column', () => {
    expect(schema.automationRules.conditionTree).toBeDefined();
  });

  it('automation_rule_actions table is exported with sortOrder', () => {
    expect(schema.automationRuleActions).toBeDefined();
    expect(schema.automationRuleActions.sortOrder).toBeDefined();
  });
});

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;

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
  await sql`TRUNCATE automation_rule_actions, automation_runs, automation_rules, workspaces RESTART IDENTITY CASCADE`;
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('ws');
  workspaceId = w.id;
});

describe('0058 backfill', () => {
  it('a flat condition is backfilled into condition_tree as one implicit AND group', async () => {
    // Insert WITHOUT condition_tree (simulate a pre-0058 row), then run the backfill UPDATE.
    const [r] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId,
        name: 'r',
        triggerEvent: 'row.created',
        condition: { property: 'row.cells.status', operator: 'equals', value: 'Done' },
        actionType: 'notify',
        actionConfig: { userId: '00000000-0000-0000-0000-000000000001' },
      })
      .returning();
    if (!r) throw new Error('rule');
    await sql`UPDATE automation_rules SET condition_tree = NULL WHERE id = ${r.id}`;
    // Re-run the idempotent backfill body from 0058.
    await sql`
      UPDATE automation_rules
      SET condition_tree = CASE
        WHEN condition ? 'operator'
          THEN jsonb_build_object('logic', 'and', 'children',
                 jsonb_build_array(jsonb_build_object(
                   'field', condition->>'property',
                   'op', condition->>'operator',
                   'value', condition->'value')))
        ELSE jsonb_build_object('logic', 'and', 'children', '[]'::jsonb)
      END
      WHERE condition_tree IS NULL`;
    const [row] = await sql`SELECT condition_tree FROM automation_rules WHERE id = ${r.id}`;
    expect(row?.condition_tree).toEqual({
      logic: 'and',
      children: [{ field: 'row.cells.status', op: 'equals', value: 'Done' }],
    });
  });

  it('empty condition backfills to an empty AND group', async () => {
    const [r] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId,
        name: 'r2',
        triggerEvent: 'row.created',
        condition: {},
        actionType: 'notify',
        actionConfig: { userId: '00000000-0000-0000-0000-000000000001' },
      })
      .returning();
    if (!r) throw new Error('rule');
    const [row] = await sql`SELECT condition_tree FROM automation_rules WHERE id = ${r.id}`;
    expect(row?.condition_tree).toEqual({ logic: 'and', children: [] });
  });

  it('legacy singular action is backfilled into automation_rule_actions at sort_order 0', async () => {
    const [r] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId,
        name: 'r3',
        triggerEvent: 'row.created',
        condition: {},
        actionType: 'send_webhook',
        actionConfig: { webhookId: 'wh1' },
      })
      .returning();
    if (!r) throw new Error('rule');
    const actions = await db
      .select()
      .from(schema.automationRuleActions)
      .where(eq(schema.automationRuleActions.ruleId, r.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.sortOrder).toBe(0);
    expect(actions[0]?.actionType).toBe('send_webhook');
  });
});
