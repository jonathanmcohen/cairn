import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { pruneRunHistory } from '@/lib/automation/run-retention';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let ruleId: string;

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
  if (!w) throw new Error('w');
  const [r] = await db
    .insert(schema.automationRules)
    .values({
      workspaceId: w.id,
      name: 'r',
      triggerEvent: 'row.created',
      condition: {},
      actionType: 'notify',
      actionConfig: {},
    })
    .returning();
  if (!r) throw new Error('r');
  ruleId = r.id;
});

describe('pruneRunHistory', () => {
  it('keeps only the N most-recent runs per rule', async () => {
    for (let i = 0; i < 10; i++) {
      await db.insert(schema.automationRuns).values({
        ruleId,
        triggerPayload: { i },
        status: 'success',
      });
    }
    await pruneRunHistory(db, ruleId, 3);
    const remaining = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.ruleId, ruleId));
    expect(remaining).toHaveLength(3);
  });

  it('is a no-op when under the cap', async () => {
    await db
      .insert(schema.automationRuns)
      .values({ ruleId, triggerPayload: {}, status: 'success' });
    await pruneRunHistory(db, ruleId, 100);
    const remaining = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.ruleId, ruleId));
    expect(remaining).toHaveLength(1);
  });
});
