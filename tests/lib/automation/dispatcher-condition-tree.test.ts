import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { evaluateRules } from '@/lib/automation/dispatcher';
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

describe('dispatcher condition_tree', () => {
  it('matches via condition_tree OR group when the singular condition would not match', async () => {
    const [r] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId,
        name: 'r',
        triggerEvent: 'row.created',
        condition: { property: 'row.id', operator: 'equals', value: 'NOPE' },
        conditionTree: {
          logic: 'or',
          children: [
            { field: 'row.id', op: 'equals', value: 'NOPE' },
            { field: 'row.id', op: 'equals', value: 'x' },
          ],
        },
        actionType: 'notify',
        actionConfig: { userId },
      })
      .returning();
    if (!r) throw new Error('r');
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });
    const runs = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.ruleId, r.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('success');
  });

  it('records failed when the condition tree exceeds the depth cap', async () => {
    let node: schema.ConditionTreeGroup = {
      logic: 'and',
      children: [{ field: 'row.id', op: 'equals', value: 'x' }],
    };
    for (let i = 0; i < 7; i++) node = { logic: 'and', children: [node] };
    const [r] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId,
        name: 'deep',
        triggerEvent: 'row.created',
        condition: {},
        conditionTree: node,
        actionType: 'notify',
        actionConfig: { userId },
      })
      .returning();
    if (!r) throw new Error('r');
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });
    const runs = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.ruleId, r.id));
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.error).toMatch(/depth/i);
  });
});
