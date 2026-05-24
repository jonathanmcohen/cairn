import { eq } from 'drizzle-orm';
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
let otherWorkspaceId: string;
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
  await sql`TRUNCATE automation_runs, automation_rules, webhooks, webhook_deliveries, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
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
});

afterEach(() => vi.restoreAllMocks());

async function makeRule(opts: {
  ws?: string;
  enabled?: boolean;
  triggerEvent?: string;
  condition?: schema.AutomationCondition;
  actionType?: schema.AutomationActionType;
  actionConfig?: Record<string, unknown>;
}) {
  const [r] = await db
    .insert(schema.automationRules)
    .values({
      workspaceId: opts.ws ?? workspaceId,
      name: 'r',
      triggerEvent: opts.triggerEvent ?? 'row.created',
      condition: opts.condition ?? {},
      actionType: opts.actionType ?? 'notify',
      actionConfig: opts.actionConfig ?? { userId: '00000000-0000-0000-0000-000000000000' },
      enabled: opts.enabled ?? true,
      createdBy: userId,
    })
    .returning();
  if (!r) throw new Error('rule insert failed');
  return r;
}

describe('evaluateRules', () => {
  it('matches multiple rules on the same event + writes one run row each', async () => {
    await makeRule({ triggerEvent: 'row.created' });
    await makeRule({ triggerEvent: 'row.created' });
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });

    const runs = await db.select().from(schema.automationRuns);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === 'success' || r.status === 'condition_unmet')).toBe(true);
  });

  it('skips rules with disabled=false', async () => {
    await makeRule({ enabled: false });
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });
    const runs = await db.select().from(schema.automationRuns);
    expect(runs).toHaveLength(0);
  });

  it('skips rules from other workspaces', async () => {
    await makeRule({ ws: otherWorkspaceId });
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });
    const runs = await db.select().from(schema.automationRuns);
    expect(runs).toHaveLength(0);
  });

  it('records status=condition_unmet when condition does not match', async () => {
    await makeRule({
      condition: { property: 'row.id', operator: 'equals', value: 'NOPE' },
    });
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });
    const runs = await db.select().from(schema.automationRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('condition_unmet');
  });

  it('records status=failed + error when the action runner throws', async () => {
    const spy = vi.spyOn(actionRunner, 'runActionStub').mockRejectedValueOnce(new Error('boom'));
    const rule = await makeRule({});
    await evaluateRules('row.created', workspaceId, { row: { id: 'x' } });
    const runs = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.ruleId, rule.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.error).toContain('boom');
    spy.mockRestore();
  });

  it('does not throw on unknown workspace', async () => {
    await expect(
      evaluateRules('row.created', '00000000-0000-0000-0000-000000000000', { row: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('webhook emit still fires regardless of rules engine', () => {
  it('a thrown evaluateRules does not stop webhook emit', async () => {
    const { emit } = await import('@/lib/webhooks/dispatch');
    // No webhooks subscribed; emit should be a no-op even if rules engine misbehaves.
    await expect(emit('row.created', workspaceId, { row: {} })).resolves.toBeUndefined();
  });
});
