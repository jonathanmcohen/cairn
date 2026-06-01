# Cairn v0.9.8 — G5: Workflow builder (audit item J, all four)

**For agentic workers:** REQUIRED SUB-SKILL — invoke `superpowers:test-driven-development` before writing any code in every task below. Each task is RED → GREEN → REFACTOR → COMMIT. Do not skip the run-to-fail step.

**Goal:** Deliver all four workflow-builder upgrades from spec Section 3 G5 / decision 4: (1) nested AND/OR condition groups with a recursive dispatcher evaluator (depth cap 5), (2) drag-to-reorder action cards persisted by `sort_order` and executed in order, (3) a searchable templates gallery (filter by name/description, show all — not the current 3-button grid), (4) a run-history sub-tab where the dispatcher records each run with a retention cap (~100/automation). Existing automation rules continue to evaluate unchanged.

**Architecture (grounded by reading `src/lib/automation` + `src/components/automation` — these supersede the spec's idealized names):**
- The automation table is **`automation_rules`** (`src/db/schema/automation-rules.ts`), NOT "automations". It stores a **singular** `condition` jsonb (`AutomationCondition` = `{}` | `{property,operator,value}`), a **singular** `actionType` + `actionConfig`, and a `builder` jsonb editor blob (`BuilderModel`, added in migration `0056`). There is **no separate actions table** — multi-action is editor-only state today and is rejected by `compileBuilder` (`builder.ts:112-116`).
- The **run-history table already exists**: `automation_runs` (`src/db/schema/automation-runs.ts`) with `ruleId`, `triggerPayload`, `status` (`success`|`failed`|`condition_unmet`), `error`, `createdAt`. The spec's proposed shape (`started_at/finished_at/trigger_digest`, status `success|error|skipped`) is **superseded** by this shipped table; we keep the shipped columns and add only retention pruning. The run-history sub-tab UI (`run-history.tsx`), API (`rules/[ruleId]/runs/route.ts`) and lib (`runs.ts`) already exist.
- The dispatcher is **`src/lib/automation/dispatcher.ts#evaluateRules`**: loads enabled rules for `(workspaceId, event)`, calls `evaluateCondition(rule.condition, payload)` (`condition.ts:26`), runs `actionRunner.runAction(rule.actionType, rule.actionConfig, …)` (`actions/index.ts:27`), writes one `automation_runs` row per evaluation. It reads the **singular** `condition`/`actionType`/`actionConfig`, NOT the `builder` blob.
- The builder canvas is `src/components/automation/builder/rule-canvas.tsx`; condition rows in `condition-group.tsx` (flat list, single combinator); action cards rendered via `action-card-host.tsx`; templates in `templates-gallery.tsx` (3-button grid) sourced from `src/lib/automation/templates.ts` (`BUILDER_TEMPLATES`). The list + tabs are in `rule-list.tsx` (Builder/Run-history tabs already wired, lines 128-161).
- **Migrations:** latest applied is `0057`. Drizzle's `migrate()` (`src/db/migrate.ts:44`) reads `drizzle/migrations/meta/_journal.json` — every new `.sql` file MUST also get a journal entry (idx/tag). `db:generate` does not emit self-FKs/triggers/check constraints — hand-write the full SQL.
- **i18n:** strings via `useT()` from `@/lib/i18n/provider`; keys live in `messages/{en,es,ar}.json`; `pnpm i18n:check` (`scripts/i18n-audit.ts`) must report no NEW missing/unused keys.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 6 strict · Drizzle ORM 0.45 + Postgres 16 · Biome v2 · Vitest 4 + Testcontainers v12 (real Postgres, `tests/helpers/db.ts` singleton, isolation ON) · Tailwind v4 + shadcn/ui · `@dnd-kit/core` + `@dnd-kit/sortable` (already a dep — used by db-view column reorder + favorites reorder).

---

## Files

### Migrations (Create)
- `drizzle/migrations/0058_automation_condition_tree.sql` — add jsonb `condition_tree` to `automation_rules` + backfill from singular `condition`.
- `drizzle/migrations/0059_automation_action_sort_order.sql` — add `sort_order` int to the new `automation_rule_actions` table + backfill by array index.
- `drizzle/migrations/0061_automation_run_retention.sql` — retention-prune trigger/index on `automation_runs` (run-history table already exists from a prior migration).
- `drizzle/migrations/meta/_journal.json` (Modify) — append idx 58, 59, 61 entries.

> **Migration numbering note:** 0060 is reserved by the v0.9.8 spec for `chat_oauth_installs` (group G6). This G5 plan owns 0058, 0059, 0061. If G6 has not yet landed when G5 runs, still skip 0060 — the journal must stay gapless **in `idx` order** but Drizzle keys on the `tag`/folder name, so a missing `0060_*.sql` is fine as long as no journal entry references it. Append journal entries for 58/59/61 only.

### Schema (Modify / Create)
- `src/db/schema/automation-rules.ts` (Modify ~line 43) — add `conditionTree` column + `ConditionTree`/`ConditionNode`/`GroupNode` types.
- `src/db/schema/automation-rule-actions.ts` (Create) — new ordered-actions table.
- `src/db/schema/index.ts` (Modify) — export the new table.

### Lib (Create / Modify)
- `src/lib/automation/condition-tree.ts` (Create) — `evaluateConditionTree(tree, payload, depth?)` recursive evaluator + depth cap + `MAX_CONDITION_TREE_DEPTH`.
- `src/lib/automation/condition-tree-backfill.ts` (Create) — `flatConditionToTree(condition)` pure helper (mirrors the SQL backfill for unit testing).
- `src/lib/automation/dispatcher.ts` (Modify ~line 50) — prefer `conditionTree` when present, fall back to singular `condition`; run ordered actions; retention prune.
- `src/lib/automation/run-retention.ts` (Create) — `pruneRunHistory(db, ruleId, cap)`.
- `src/lib/automation/builder.ts` (Modify) — extend `BuilderModel.conditions` to a recursive `ConditionTreeModel`; `compileBuilder` emits `conditionTree` + ordered `actions`; `decompileRule` reverses it.
- `src/lib/automation/templates.ts` (Modify) — add `descKey` to each template for search.

### Components (Create / Modify)
- `src/components/automation/builder/condition-group.tsx` (Modify) — recursive nested groups, per-group AND/OR toggle, add-group button, depth guard.
- `src/components/automation/builder/action-list.tsx` (Create) — dnd-kit sortable action cards wrapping `ActionCardHost`.
- `src/components/automation/builder/rule-canvas.tsx` (Modify ~line 178-196) — mount recursive `ConditionGroup` + sortable `ActionList`.
- `src/components/automation/builder/templates-gallery.tsx` (Modify) — search input + filtered full list.

### i18n (Modify)
- `messages/en.json`, `messages/es.json`, `messages/ar.json` — new builder keys.

### Tests (Create)
- `tests/lib/automation/condition-tree.test.ts`
- `tests/lib/automation/condition-tree-backfill.test.ts`
- `tests/lib/automation/run-retention.test.ts`
- `tests/db/automation-condition-tree-migration.test.ts`
- `tests/lib/automation/dispatcher-condition-tree.test.ts`
- `tests/lib/automation/dispatcher-ordered-actions.test.ts`
- `tests/components/automation/templates-gallery-search.test.tsx`
- `tests/components/automation/condition-group-nested.test.tsx`
- `tests/components/automation/action-list-reorder.test.tsx`

---

## Task 1 — Recursive condition-tree evaluator + depth cap

**Files:** Create `src/lib/automation/condition-tree.ts`, `tests/lib/automation/condition-tree.test.ts`.

This is a pure function — no DB. It reuses the existing per-leaf operator logic by importing `evaluateCondition` from `condition.ts`, so the truth table for a single leaf stays identical to today.

### Step 1.1 — Write the failing test

Create `tests/lib/automation/condition-tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type ConditionTree,
  evaluateConditionTree,
  MAX_CONDITION_TREE_DEPTH,
} from '@/lib/automation/condition-tree';

const payload = { row: { cells: { status: 'Done', priority: 'High', count: 5 } } };

function leaf(property: string, value: unknown) {
  return { field: property, op: 'equals' as const, value };
}

describe('evaluateConditionTree', () => {
  it('empty group (no children) matches everything', () => {
    expect(evaluateConditionTree({ logic: 'and', children: [] }, payload)).toBe(true);
    expect(evaluateConditionTree({ logic: 'or', children: [] }, payload)).toBe(true);
  });

  it('AND truth table', () => {
    const t: ConditionTree = {
      logic: 'and',
      children: [leaf('row.cells.status', 'Done'), leaf('row.cells.priority', 'High')],
    };
    expect(evaluateConditionTree(t, payload)).toBe(true);
    expect(
      evaluateConditionTree(
        { logic: 'and', children: [leaf('row.cells.status', 'Done'), leaf('row.cells.priority', 'Low')] },
        payload,
      ),
    ).toBe(false);
  });

  it('OR truth table', () => {
    expect(
      evaluateConditionTree(
        { logic: 'or', children: [leaf('row.cells.status', 'Open'), leaf('row.cells.priority', 'High')] },
        payload,
      ),
    ).toBe(true);
    expect(
      evaluateConditionTree(
        { logic: 'or', children: [leaf('row.cells.status', 'Open'), leaf('row.cells.priority', 'Low')] },
        payload,
      ),
    ).toBe(false);
  });

  it('nested group: (status=Done OR priority=Low) AND priority=High', () => {
    const t: ConditionTree = {
      logic: 'and',
      children: [
        { logic: 'or', children: [leaf('row.cells.status', 'Done'), leaf('row.cells.priority', 'Low')] },
        leaf('row.cells.priority', 'High'),
      ],
    };
    expect(evaluateConditionTree(t, payload)).toBe(true);
  });

  it('uses leaf operators (gt) identically to evaluateCondition', () => {
    const t: ConditionTree = {
      logic: 'and',
      children: [{ field: 'row.cells.count', op: 'gt', value: 3 }],
    };
    expect(evaluateConditionTree(t, payload)).toBe(true);
  });

  it('throws past the depth cap', () => {
    // Build a chain one level deeper than the cap.
    let node: ConditionTree = { logic: 'and', children: [leaf('row.cells.status', 'Done')] };
    for (let i = 0; i < MAX_CONDITION_TREE_DEPTH + 1; i++) {
      node = { logic: 'and', children: [node] };
    }
    expect(() => evaluateConditionTree(node, payload)).toThrow(/depth/i);
    expect(MAX_CONDITION_TREE_DEPTH).toBe(5);
  });
});
```

### Step 1.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/condition-tree.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/automation/condition-tree'`.

### Step 1.3 — Minimal implementation

Create `src/lib/automation/condition-tree.ts`:

```ts
import type { AutomationOperator } from '@/db/schema';
import { evaluateCondition } from '@/lib/automation/condition';

/** Max nesting depth for a condition tree. Builder + dispatcher enforce this. */
export const MAX_CONDITION_TREE_DEPTH = 5;

/** A single leaf condition. `field` is a dotted path; `op`/`value` mirror the singular condition. */
export type ConditionNode = {
  field: string;
  op: AutomationOperator;
  value: unknown;
};

/** A logic group joining children with AND/OR. Children may themselves be groups. */
export type GroupNode = {
  logic: 'and' | 'or';
  children: Array<ConditionNode | GroupNode>;
};

/** The root is always a group. */
export type ConditionTree = GroupNode;

function isGroup(n: ConditionNode | GroupNode): n is GroupNode {
  return 'logic' in n && Array.isArray((n as GroupNode).children);
}

/**
 * Recursively evaluate a condition tree against the trigger payload.
 * - An empty group (no children) matches everything (parity with the singular `{}` condition).
 * - A leaf reuses `evaluateCondition`, so single-leaf semantics are unchanged from v0.7.
 * - Throws if nesting exceeds MAX_CONDITION_TREE_DEPTH (caught by the dispatcher → run marked failed).
 */
export function evaluateConditionTree(
  tree: ConditionTree,
  payload: unknown,
  depth = 0,
): boolean {
  if (depth > MAX_CONDITION_TREE_DEPTH) {
    throw new Error(`condition tree exceeds max depth ${MAX_CONDITION_TREE_DEPTH}`);
  }
  const { logic, children } = tree;
  if (children.length === 0) return true;

  const results = children.map((child) =>
    isGroup(child)
      ? evaluateConditionTree(child, payload, depth + 1)
      : evaluateCondition({ property: child.field, operator: child.op, value: child.value }, payload),
  );

  return logic === 'and' ? results.every(Boolean) : results.some(Boolean);
}
```

### Step 1.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/condition-tree.test.ts
```
Expected: PASS — 6 passed.

### Step 1.5 — Commit

```sh
git add src/lib/automation/condition-tree.ts tests/lib/automation/condition-tree.test.ts && git commit -m "feat(automation): recursive AND/OR condition-tree evaluator with depth cap"
```

---

## Task 2 — Flat-condition → tree backfill helper

**Files:** Create `src/lib/automation/condition-tree-backfill.ts`, `tests/lib/automation/condition-tree-backfill.test.ts`.

This pure helper is the JS mirror of the SQL backfill in Task 4, and is what the dispatcher uses as a fallback when `conditionTree` is null.

### Step 2.1 — Write the failing test

Create `tests/lib/automation/condition-tree-backfill.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flatConditionToTree } from '@/lib/automation/condition-tree-backfill';

describe('flatConditionToTree', () => {
  it('empty match-all condition becomes an empty AND group', () => {
    expect(flatConditionToTree({})).toEqual({ logic: 'and', children: [] });
  });

  it('a single flat condition becomes one implicit AND group with one leaf', () => {
    expect(
      flatConditionToTree({ property: 'row.cells.status', operator: 'equals', value: 'Done' }),
    ).toEqual({
      logic: 'and',
      children: [{ field: 'row.cells.status', op: 'equals', value: 'Done' }],
    });
  });
});
```

### Step 2.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/condition-tree-backfill.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/automation/condition-tree-backfill'`.

### Step 2.3 — Minimal implementation

Create `src/lib/automation/condition-tree-backfill.ts`:

```ts
import type { AutomationCondition } from '@/db/schema';
import type { ConditionTree } from '@/lib/automation/condition-tree';

/**
 * Wrap an existing singular automation condition as one implicit AND group.
 * Mirrors the SQL backfill in migration 0058 so the dispatcher can compute the
 * same fallback at runtime for rows whose condition_tree is still null.
 */
export function flatConditionToTree(condition: AutomationCondition): ConditionTree {
  if (!('operator' in condition)) return { logic: 'and', children: [] };
  return {
    logic: 'and',
    children: [{ field: condition.property, op: condition.operator, value: condition.value }],
  };
}
```

### Step 2.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/condition-tree-backfill.test.ts
```
Expected: PASS — 2 passed.

### Step 2.5 — Commit

```sh
git add src/lib/automation/condition-tree-backfill.ts tests/lib/automation/condition-tree-backfill.test.ts && git commit -m "feat(automation): flatConditionToTree backfill helper"
```

---

## Task 3 — Schema: `condition_tree` column + `automation_rule_actions` table

**Files:** Modify `src/db/schema/automation-rules.ts`; Create `src/db/schema/automation-rule-actions.ts`; Modify `src/db/schema/index.ts`. No migration yet (Task 4 writes the SQL) — this task only adds the Drizzle table definitions so they type-check, with a tiny compile/import test.

### Step 3.1 — Write the failing test

Create `tests/db/automation-condition-tree-migration.test.ts` (this file grows in Task 4; start with the schema-shape assertions only):

```ts
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';

describe('automation schema additions', () => {
  it('automation_rules exposes a conditionTree column', () => {
    expect(schema.automationRules.conditionTree).toBeDefined();
  });

  it('automation_rule_actions table is exported with sortOrder', () => {
    expect(schema.automationRuleActions).toBeDefined();
    expect(schema.automationRuleActions.sortOrder).toBeDefined();
  });
});
```

### Step 3.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/db/automation-condition-tree-migration.test.ts
```
Expected: FAIL — `schema.automationRules.conditionTree` is undefined / `automationRuleActions` is not exported.

### Step 3.3 — Implementation

In `src/db/schema/automation-rules.ts`, add the tree types and column. Add this import-and-type block above `automationRules` (after the existing `AutomationActionType` type, ~line 28):

```ts
/** A single leaf in the condition tree (mirrors src/lib/automation/condition-tree.ts). */
export type ConditionTreeLeaf = {
  field: string;
  op: AutomationOperator;
  value: unknown;
};

/** A logic group joining children with AND/OR; children may be groups (nested). */
export type ConditionTreeGroup = {
  logic: 'and' | 'or';
  children: Array<ConditionTreeLeaf | ConditionTreeGroup>;
};
```

Then add the column inside the `automationRules` `pgTable({...})` object, right after the existing `condition` column (line 43):

```ts
    // Nested AND/OR tree (v0.9.8). When non-null the dispatcher evaluates this
    // instead of the singular `condition`. Backfilled in migration 0058 as one
    // implicit {logic:'and', children:[...]} group from the flat condition.
    conditionTree: jsonb('condition_tree').$type<ConditionTreeGroup | null>(),
```

Create `src/db/schema/automation-rule-actions.ts`:

```ts
import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { automationRules } from './automation-rules';

/**
 * Ordered actions for a rule (v0.9.8 drag-reorder). Each row is one action card;
 * `sortOrder` is the execution order the dispatcher honors. Existing single-action
 * rules keep using automation_rules.actionType/actionConfig — this table is the
 * multi-action path, backfilled from the legacy singular action at index 0.
 */
export const automationRuleActions = pgTable(
  'automation_rule_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    actionType: text('action_type').notNull(),
    actionConfig: jsonb('action_config').$type<Record<string, unknown>>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    byRuleOrder: index('automation_rule_actions_rule_order_idx').on(t.ruleId, t.sortOrder),
  }),
);

export type AutomationRuleAction = typeof automationRuleActions.$inferSelect;
export type NewAutomationRuleAction = typeof automationRuleActions.$inferInsert;
```

In `src/db/schema/index.ts`, add an export line alongside the other automation re-exports:

```ts
export * from './automation-rule-actions';
```

### Step 3.4 — Run it to confirm GREEN + typecheck

```sh
source ~/.zshenv && pnpm vitest run tests/db/automation-condition-tree-migration.test.ts && pnpm typecheck
```
Expected: 2 passed; typecheck exits 0.

### Step 3.5 — Commit

```sh
git add src/db/schema/automation-rules.ts src/db/schema/automation-rule-actions.ts src/db/schema/index.ts tests/db/automation-condition-tree-migration.test.ts && git commit -m "feat(automation): add condition_tree column + automation_rule_actions table"
```

---

## Task 4 — Migrations 0058 + 0059 (condition_tree + sort_order) with reversible backfill

**Files:** Create `drizzle/migrations/0058_automation_condition_tree.sql`, `drizzle/migrations/0059_automation_action_sort_order.sql`; Modify `drizzle/migrations/meta/_journal.json`; extend `tests/db/automation-condition-tree-migration.test.ts` with a Testcontainers backfill assertion.

Drizzle's migrator applies any `.sql` file listed in `_journal.json`. We hand-write the SQL (Drizzle can't express the JSON backfill) and append journal entries.

### Step 4.1 — Write the failing test (append to the existing file)

Append to `tests/db/automation-condition-tree-migration.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../helpers/db';

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
```

Add the needed top-of-file import: `import { eq } from 'drizzle-orm';`.

> Note: the third test relies on a `0059` row-insert trigger that backfills NEW singular-action rules. We add that trigger so new rules created through the legacy API path still populate the ordered-actions table. See Step 4.3.

### Step 4.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/db/automation-condition-tree-migration.test.ts
```
Expected: FAIL — `column "condition_tree" does not exist` / `relation "automation_rule_actions" does not exist`.

### Step 4.3 — Write the migrations

Create `drizzle/migrations/0058_automation_condition_tree.sql`:

```sql
-- v0.9.8 G5: nested AND/OR condition tree on automation_rules.
-- Reversible: see the rollback block at the bottom (commented; run by hand to revert).
ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "condition_tree" jsonb;

-- Backfill: wrap each existing flat condition as one implicit AND group.
-- Idempotent — only touches rows whose tree is still NULL.
UPDATE "automation_rules"
SET "condition_tree" = CASE
  WHEN "condition" ? 'operator'
    THEN jsonb_build_object('logic', 'and', 'children',
           jsonb_build_array(jsonb_build_object(
             'field', "condition"->>'property',
             'op',    "condition"->>'operator',
             'value', "condition"->'value')))
  ELSE jsonb_build_object('logic', 'and', 'children', '[]'::jsonb)
END
WHERE "condition_tree" IS NULL;

-- ROLLBACK (run manually to revert this migration):
--   ALTER TABLE "automation_rules" DROP COLUMN IF EXISTS "condition_tree";
```

Create `drizzle/migrations/0059_automation_action_sort_order.sql`:

```sql
-- v0.9.8 G5: ordered multi-action support.
CREATE TABLE IF NOT EXISTS "automation_rule_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id" uuid NOT NULL REFERENCES "automation_rules"("id") ON DELETE CASCADE,
  "action_type" text NOT NULL,
  "action_config" jsonb NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "automation_rule_actions_rule_order_idx"
  ON "automation_rule_actions" ("rule_id", "sort_order");

-- Backfill: each existing rule's singular action becomes its action at index 0.
INSERT INTO "automation_rule_actions" ("rule_id", "action_type", "action_config", "sort_order")
SELECT r."id", r."action_type", r."action_config", 0
FROM "automation_rules" r
WHERE NOT EXISTS (
  SELECT 1 FROM "automation_rule_actions" a WHERE a."rule_id" = r."id"
);

-- Keep the ordered-actions table populated for rules created via the legacy
-- singular-action API path (which only writes automation_rules). A NEW rule with
-- no ordered actions gets its singular action mirrored at sort_order 0.
CREATE OR REPLACE FUNCTION "automation_backfill_action"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "automation_rule_actions" ("rule_id", "action_type", "action_config", "sort_order")
  VALUES (NEW."id", NEW."action_type", NEW."action_config", 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "automation_rules_backfill_action" ON "automation_rules";
CREATE TRIGGER "automation_rules_backfill_action"
  AFTER INSERT ON "automation_rules"
  FOR EACH ROW EXECUTE FUNCTION "automation_backfill_action"();

-- ROLLBACK (run manually):
--   DROP TRIGGER IF EXISTS "automation_rules_backfill_action" ON "automation_rules";
--   DROP FUNCTION IF EXISTS "automation_backfill_action"();
--   DROP TABLE IF EXISTS "automation_rule_actions";
```

Append two entries to `drizzle/migrations/meta/_journal.json` inside the `entries` array, after the `0057` object (use the next sequential timestamps; keep `version: "7"`):

```json
    {
      "idx": 58,
      "version": "7",
      "when": 1780414997491,
      "tag": "0058_automation_condition_tree",
      "breakpoints": true
    },
    {
      "idx": 59,
      "version": "7",
      "when": 1780501397491,
      "tag": "0059_automation_action_sort_order",
      "breakpoints": true
    }
```

### Step 4.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/db/automation-condition-tree-migration.test.ts
```
Expected: PASS — 5 passed (2 schema-shape + 3 backfill).

### Step 4.5 — Commit

```sh
git add drizzle/migrations/0058_automation_condition_tree.sql drizzle/migrations/0059_automation_action_sort_order.sql drizzle/migrations/meta/_journal.json tests/db/automation-condition-tree-migration.test.ts && git commit -m "feat(automation): migrations 0058 condition_tree + 0059 ordered actions with reversible backfill"
```

---

## Task 5 — Dispatcher reads condition_tree + ordered actions

**Files:** Modify `src/lib/automation/dispatcher.ts`; Create `tests/lib/automation/dispatcher-condition-tree.test.ts`, `tests/lib/automation/dispatcher-ordered-actions.test.ts`.

The dispatcher must: (a) evaluate `conditionTree` when present (fallback to `flatConditionToTree(condition)`), capping depth → a depth-cap throw becomes a `failed` run; (b) run actions from `automation_rule_actions` ordered by `sort_order` (fallback to the singular action when none exist).

### Step 5.1 — Write the failing tests

Create `tests/lib/automation/dispatcher-condition-tree.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const [u] = await db.insert(schema.users).values({ email: 'a@b.c', passwordHash: 'h', name: 'A' }).returning();
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
    const runs = await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.ruleId, r.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('success');
  });

  it('records failed when the condition tree exceeds the depth cap', async () => {
    let node: schema.ConditionTreeGroup = { logic: 'and', children: [{ field: 'row.id', op: 'equals', value: 'x' }] };
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
    const runs = await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.ruleId, r.id));
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.error).toMatch(/depth/i);
  });
});
```

Create `tests/lib/automation/dispatcher-ordered-actions.test.ts`:

```ts
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
  const [u] = await db.insert(schema.users).values({ email: 'a@b.c', passwordHash: 'h', name: 'A' }).returning();
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
```

### Step 5.2 — Run them to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/dispatcher-condition-tree.test.ts tests/lib/automation/dispatcher-ordered-actions.test.ts
```
Expected: FAIL — dispatcher still ignores `conditionTree` and the ordered-actions table (OR-group test gets `condition_unmet`; order test fails the equality / only runs the singular action).

### Step 5.3 — Implementation

Edit `src/lib/automation/dispatcher.ts`. Add imports near the top (after the existing imports):

```ts
import { asc } from 'drizzle-orm';
import { evaluateConditionTree } from './condition-tree';
import { flatConditionToTree } from './condition-tree-backfill';
```

Replace the per-rule body inside the `for (const rule of rules)` loop. The current body computes `matched` then runs the singular action. Replace it with tree evaluation + ordered actions:

```ts
    for (const rule of rules) {
      // Prefer the nested tree (v0.9.8); fall back to the singular condition.
      const tree = rule.conditionTree ?? flatConditionToTree(rule.condition);
      let matched: boolean;
      try {
        matched = evaluateConditionTree(tree, payload);
      } catch (err) {
        // Depth-cap or malformed tree → record a failed run, don't run actions.
        await db.insert(schema.automationRuns).values({
          ruleId: rule.id,
          triggerPayload: (payload ?? {}) as Record<string, unknown>,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (!matched) {
        await db.insert(schema.automationRuns).values({
          ruleId: rule.id,
          triggerPayload: (payload ?? {}) as Record<string, unknown>,
          status: 'condition_unmet',
        });
        continue;
      }

      // Ordered actions (v0.9.8). Fall back to the singular action if the
      // ordered table has no rows for this rule (defensive — the trigger keeps
      // it populated, but a manually-inserted rule may not have run it yet).
      const ordered = await db
        .select()
        .from(schema.automationRuleActions)
        .where(eq(schema.automationRuleActions.ruleId, rule.id))
        .orderBy(asc(schema.automationRuleActions.sortOrder));
      const actions =
        ordered.length > 0
          ? ordered.map((a) => ({ type: a.actionType as schema.AutomationActionType, config: a.actionConfig }))
          : [{ type: rule.actionType as schema.AutomationActionType, config: rule.actionConfig }];

      try {
        for (const action of actions) {
          await actionRunner.runAction(action.type, action.config, payload, {
            ruleId: rule.id,
            workspaceId: rule.workspaceId,
            createdBy: rule.createdBy,
          });
        }
        await db.insert(schema.automationRuns).values({
          ruleId: rule.id,
          triggerPayload: (payload ?? {}) as Record<string, unknown>,
          status: 'success',
        });
      } catch (err) {
        await db.insert(schema.automationRuns).values({
          ruleId: rule.id,
          triggerPayload: (payload ?? {}) as Record<string, unknown>,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        logger.warn(
          {
            ruleId: rule.id,
            err: err instanceof Error ? { message: err.message, name: err.name } : err,
          },
          '[automation] action failed',
        );
      }
    }
```

Remove the now-unused `import { evaluateCondition } from './condition';` (Biome will flag it).

### Step 5.4 — Run them to confirm GREEN + the existing dispatcher suite still passes

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/dispatcher-condition-tree.test.ts tests/lib/automation/dispatcher-ordered-actions.test.ts tests/lib/automation/dispatcher.test.ts
```
Expected: all PASS (the legacy `dispatcher.test.ts` still passes because `flatConditionToTree` reproduces the old singular behavior and the ordered-actions table is trigger-backfilled).

### Step 5.5 — Commit

```sh
git add src/lib/automation/dispatcher.ts tests/lib/automation/dispatcher-condition-tree.test.ts tests/lib/automation/dispatcher-ordered-actions.test.ts && git commit -m "feat(automation): dispatcher evaluates condition_tree + runs ordered actions"
```

---

## Task 6 — Run-history retention cap

**Files:** Create `src/lib/automation/run-retention.ts`, `tests/lib/automation/run-retention.test.ts`; Modify `src/lib/automation/dispatcher.ts` (call prune after writing a run); Create `drizzle/migrations/0061_automation_run_retention.sql` + journal entry.

The runs table + history UI already exist; the gap is unbounded growth. Cap to the N most-recent per rule (default 100). We prune in the dispatcher (cheap delete keyed by the indexed `rule_id, created_at`).

### Step 6.1 — Write the failing test

Create `tests/lib/automation/run-retention.test.ts`:

```ts
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
    .values({ workspaceId: w.id, name: 'r', triggerEvent: 'row.created', condition: {}, actionType: 'notify', actionConfig: {} })
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
    const remaining = await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.ruleId, ruleId));
    expect(remaining).toHaveLength(3);
  });

  it('is a no-op when under the cap', async () => {
    await db.insert(schema.automationRuns).values({ ruleId, triggerPayload: {}, status: 'success' });
    await pruneRunHistory(db, ruleId, 100);
    const remaining = await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.ruleId, ruleId));
    expect(remaining).toHaveLength(1);
  });
});
```

### Step 6.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/run-retention.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/automation/run-retention'`.

### Step 6.3 — Implementation

Create `src/lib/automation/run-retention.ts`:

```ts
import { sql as rawSql } from 'drizzle-orm';
import type { getDb } from '@/db/client';

/** Default per-rule cap on stored run-history rows. */
export const RUN_HISTORY_CAP = 100;

/**
 * Delete all but the `cap` most-recent automation_runs for one rule. Keyed by the
 * (rule_id, created_at) index. Called by the dispatcher after each run insert so
 * history never grows unbounded; safe to call when already under the cap.
 */
export async function pruneRunHistory(
  db: ReturnType<typeof getDb>,
  ruleId: string,
  cap: number = RUN_HISTORY_CAP,
): Promise<void> {
  await db.execute(rawSql`
    DELETE FROM automation_runs
    WHERE rule_id = ${ruleId}::uuid
      AND id NOT IN (
        SELECT id FROM automation_runs
        WHERE rule_id = ${ruleId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${cap}
      )
  `);
}
```

In `src/lib/automation/dispatcher.ts`, import the prune helper:

```ts
import { pruneRunHistory } from './run-retention';
```

Then call it once at the end of each per-rule iteration. The simplest correct placement is right before the loop's closing brace `}` (after either the success or failed insert paths). Add this as the last statement inside the `for (const rule of rules)` block:

```ts
      await pruneRunHistory(db, rule.id);
```

(Place it after the `try/catch` that writes the run row, still inside the `for`.)

Create `drizzle/migrations/0061_automation_run_retention.sql` (the runs table already exists from a prior migration; this only adds the supporting index the prune query relies on):

```sql
-- v0.9.8 G5: support fast per-rule retention pruning of automation_runs.
CREATE INDEX IF NOT EXISTS "automation_runs_rule_created_idx"
  ON "automation_runs" ("rule_id", "created_at" DESC);

-- ROLLBACK (run manually):
--   DROP INDEX IF EXISTS "automation_runs_rule_created_idx";
```

Append the journal entry to `drizzle/migrations/meta/_journal.json` after the `0059` object:

```json
    {
      "idx": 61,
      "version": "7",
      "when": 1780674197491,
      "tag": "0061_automation_run_retention",
      "breakpoints": true
    }
```

### Step 6.4 — Run it to confirm GREEN + dispatcher suite

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/run-retention.test.ts tests/lib/automation/dispatcher.test.ts tests/lib/automation/dispatcher-ordered-actions.test.ts
```
Expected: all PASS.

### Step 6.5 — Commit

```sh
git add src/lib/automation/run-retention.ts src/lib/automation/dispatcher.ts drizzle/migrations/0061_automation_run_retention.sql drizzle/migrations/meta/_journal.json tests/lib/automation/run-retention.test.ts && git commit -m "feat(automation): cap run history per rule + migration 0061 supporting index"
```

---

## Task 7 — Builder model: recursive condition tree + ordered actions in compile/decompile

**Files:** Modify `src/lib/automation/builder.ts`; extend `tests/lib/automation/builder.test.ts`.

`compileBuilder` currently rejects >1 condition row and >1 action (`builder.ts:96-116`). Lift both restrictions: emit a `conditionTree` + an ordered `actions` array. Keep emitting the singular `condition`/`actionType`/`actionConfig` (first leaf / first action) for backward compatibility with the legacy dispatcher fallback and the existing API/list code.

### Step 7.1 — Write the failing test (append to existing file)

Append to `tests/lib/automation/builder.test.ts`:

```ts
import { compileBuilder } from '@/lib/automation/builder';

describe('compileBuilder v0.9.8 — tree + ordered actions', () => {
  it('compiles a nested AND/OR group into conditionTree', () => {
    const model = {
      triggerEvent: 'row.created' as const,
      conditions: {
        logic: 'and' as const,
        children: [
          {
            logic: 'or' as const,
            children: [
              { id: 'c1', field: 'row.cells.status', op: 'equals' as const, value: 'Done' },
              { id: 'c2', field: 'row.cells.status', op: 'equals' as const, value: 'Archived' },
            ],
          },
          { id: 'c3', field: 'row.cells.priority', op: 'equals' as const, value: 'High' },
        ],
      },
      actions: [
        { id: 'a1', type: 'notify' as const, config: { userId: 'u1' } },
        { id: 'a2', type: 'send_webhook' as const, config: { webhookId: 'w1' } },
      ],
    };
    const result = compileBuilder('Multi', model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.conditionTree).toEqual({
      logic: 'and',
      children: [
        {
          logic: 'or',
          children: [
            { field: 'row.cells.status', op: 'equals', value: 'Done' },
            { field: 'row.cells.status', op: 'equals', value: 'Archived' },
          ],
        },
        { field: 'row.cells.priority', op: 'equals', value: 'High' },
      ],
    });
    expect(result.body.actions).toHaveLength(2);
    expect(result.body.actions[0]).toEqual({ type: 'notify', config: { userId: 'u1' }, sortOrder: 0 });
    expect(result.body.actions[1]).toEqual({ type: 'send_webhook', config: { webhookId: 'w1' }, sortOrder: 1 });
    // Singular back-compat fields still populated from the first leaf/action.
    expect(result.body.actionType).toBe('notify');
  });

  it('rejects a tree deeper than the depth cap', () => {
    let group: any = { logic: 'and', children: [{ id: 'c', field: 'row.id', op: 'equals', value: 'x' }] };
    for (let i = 0; i < 7; i++) group = { logic: 'and', children: [group] };
    const result = compileBuilder('Deep', {
      triggerEvent: 'row.created',
      conditions: group,
      actions: [{ id: 'a1', type: 'notify', config: { userId: 'u1' } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/depth/i);
  });
});
```

> The existing `builder.test.ts` asserts the OLD single-row/single-action rejections. Those assertions must be **removed or updated** in this step since the behavior is intentionally changing. Delete any test case asserting `'Only one condition is supported'` or `'Only one action is supported'`, and any test asserting `compileBuilder` errors on 2 rows/actions. Note this in the commit body.

### Step 7.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/builder.test.ts
```
Expected: FAIL — `compileBuilder` returns the old shape (`conditions.rows`) and rejects multi-row/multi-action; new fields `conditionTree`/`actions`/`sortOrder` are missing.

### Step 7.3 — Implementation

Rewrite the model + compile/decompile in `src/lib/automation/builder.ts`. Replace `ConditionRow`/`ConditionGroup`/`BuilderModel`/`CompiledRuleBody` and the `compileBuilder`/`decompileRule`/`emptyBuilder` functions with the recursive shape:

```ts
import type { AutomationActionType, AutomationCondition, AutomationOperator } from '@/db/schema';
import { type ConditionTree, MAX_CONDITION_TREE_DEPTH } from '@/lib/automation/condition-tree';
import { flatConditionToTree } from '@/lib/automation/condition-tree-backfill';
import { TRIGGER_EVENTS, type TriggerEvent } from '@/lib/automation/events';

/** One leaf condition row in the builder (carries a UI id). */
export type ConditionRow = {
  id: string;
  field: string;
  op: AutomationOperator;
  value: unknown;
};

/** A recursive logic group in the builder (carries a UI id). */
export type ConditionGroupModel = {
  id: string;
  logic: 'and' | 'or';
  children: Array<ConditionRow | ConditionGroupModel>;
};

/** One action card. */
export type ActionCard = {
  id: string;
  type: AutomationActionType;
  config: Record<string, unknown>;
};

/** Full editor state for one rule's canvas. Persisted verbatim in automation_rules.builder. */
export type BuilderModel = {
  triggerEvent: TriggerEvent;
  conditions: ConditionGroupModel;
  actions: ActionCard[];
};

/** Compiled action with its execution order. */
export type CompiledAction = {
  type: AutomationActionType;
  config: Record<string, unknown>;
  sortOrder: number;
};

/** The body the API persists: singular back-compat fields + tree + ordered actions. */
export type CompiledRuleBody = {
  name: string;
  triggerEvent: TriggerEvent;
  condition: AutomationCondition;
  conditionTree: ConditionTree;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
  actions: CompiledAction[];
};

export type CompileResult = { ok: true; body: CompiledRuleBody } | { ok: false; error: string };

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

function isGroupModel(n: ConditionRow | ConditionGroupModel): n is ConditionGroupModel {
  return 'logic' in n && Array.isArray((n as ConditionGroupModel).children);
}

/** A fresh canvas: chosen trigger, empty AND group, one (incomplete) notify action. */
export function emptyBuilder(triggerEvent: TriggerEvent): BuilderModel {
  return {
    triggerEvent,
    conditions: { id: newId(), logic: 'and', children: [] },
    actions: [{ id: newId(), type: 'notify', config: {} }],
  };
}

/** Strip UI ids → the persisted ConditionTree; throws past the depth cap (caller catches). */
function toTree(group: ConditionGroupModel, depth = 0): ConditionTree {
  if (depth > MAX_CONDITION_TREE_DEPTH) {
    throw new Error(`condition group is nested too deep (max ${MAX_CONDITION_TREE_DEPTH})`);
  }
  return {
    logic: group.logic,
    children: group.children.map((c) =>
      isGroupModel(c)
        ? toTree(c, depth + 1)
        : { field: c.field, op: c.op, value: c.value },
    ),
  };
}

function validateAction(card: ActionCard): string | null {
  const c = card.config;
  switch (card.type) {
    case 'notify':
      return typeof c.userId === 'string' && c.userId.length > 0 ? null : 'Notify action needs a user to notify.';
    case 'set_property':
      if (typeof c.databaseId !== 'string' || c.databaseId.length === 0) return 'Set-property action needs a database.';
      if (typeof c.propertyId !== 'string' || c.propertyId.length === 0) return 'Set-property action needs a property.';
      if (!('value' in c)) return 'Set-property action needs a value.';
      return null;
    case 'create_page':
      return typeof c.templateId === 'string' && c.templateId.length > 0 ? null : 'Create-page action needs a template.';
    case 'send_webhook':
      return typeof c.webhookId === 'string' && c.webhookId.length > 0 ? null : 'Send-webhook action needs a webhook.';
    default:
      return 'Unknown action type.';
  }
}

/** First leaf of the tree, for the singular back-compat `condition` field. */
function firstLeaf(group: ConditionGroupModel): ConditionRow | null {
  for (const c of group.children) {
    if (isGroupModel(c)) {
      const nested = firstLeaf(c);
      if (nested) return nested;
    } else {
      return c;
    }
  }
  return null;
}

export function compileBuilder(name: string, model: BuilderModel): CompileResult {
  if (name.trim().length === 0) return { ok: false, error: 'Rule needs a name.' };
  if (!(TRIGGER_EVENTS as readonly string[]).includes(model.triggerEvent))
    return { ok: false, error: 'Unknown trigger event.' };

  let conditionTree: ConditionTree;
  try {
    conditionTree = toTree(model.conditions);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid condition.' };
  }

  if (model.actions.length === 0) return { ok: false, error: 'Rule needs an action.' };
  const actions: CompiledAction[] = [];
  for (const [i, card] of model.actions.entries()) {
    const actionErr = validateAction(card);
    if (actionErr) return { ok: false, error: actionErr };
    actions.push({ type: card.type, config: card.config, sortOrder: i });
  }

  const leaf = firstLeaf(model.conditions);
  const condition: AutomationCondition = leaf
    ? { property: leaf.field, operator: leaf.op, value: leaf.value }
    : {};
  const first = actions[0];
  if (!first) return { ok: false, error: 'Rule needs an action.' };

  return {
    ok: true,
    body: {
      name: name.trim(),
      triggerEvent: model.triggerEvent,
      condition,
      conditionTree,
      actionType: first.type,
      actionConfig: first.config,
      actions,
    },
  };
}

const ACTION_TYPES: readonly AutomationActionType[] = ['notify', 'send_webhook', 'set_property', 'create_page'];
function asActionType(v: string): AutomationActionType {
  return (ACTION_TYPES as readonly string[]).includes(v) ? (v as AutomationActionType) : 'notify';
}
function asTrigger(v: string): TriggerEvent {
  return (TRIGGER_EVENTS as readonly string[]).includes(v) ? (v as TriggerEvent) : 'row.created';
}

/** Shape persisted in automation_rules — singular fields plus the optional editor blob. */
export type PersistedRule = {
  triggerEvent: TriggerEvent | string;
  condition: AutomationCondition;
  actionType: AutomationActionType | string;
  actionConfig: Record<string, unknown>;
  builder: BuilderModel | null;
};

/** Rebuild the editor model. Prefers the stored builder blob; else reverses the singular fields. */
export function decompileRule(rule: PersistedRule): BuilderModel {
  if (rule.builder) {
    return {
      triggerEvent: asTrigger(rule.builder.triggerEvent),
      conditions: rule.builder.conditions,
      actions: rule.builder.actions.map((a) => ({ id: a.id, type: asActionType(a.type), config: { ...a.config } })),
    };
  }
  const tree = flatConditionToTree(rule.condition);
  return {
    triggerEvent: asTrigger(rule.triggerEvent),
    conditions: {
      id: newId(),
      logic: tree.logic,
      children: tree.children.map((c) =>
        'logic' in c ? { id: newId(), ...c } : { id: newId(), field: c.field, op: c.op, value: c.value },
      ),
    },
    actions: [{ id: newId(), type: asActionType(rule.actionType), config: { ...rule.actionConfig } }],
  };
}
```

### Step 7.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation/builder.test.ts
```
Expected: PASS (legacy single-row/single-action rejection cases removed; new tree + ordered-action cases pass).

### Step 7.5 — Commit

```sh
git add src/lib/automation/builder.ts tests/lib/automation/builder.test.ts && git commit -m "feat(automation): builder compiles nested condition tree + ordered actions

Lifts the v0.7 single-condition/single-action limit; removes the now-obsolete rejection assertions."
```

---

## Task 8 — API: persist conditionTree + ordered actions

**Files:** Modify `src/app/api/automation/rules/route.ts` (POST), `src/app/api/automation/rules/[ruleId]/route.ts` (PATCH); extend `tests/api/automation.test.ts`.

The API must accept the new `conditionTree` + `actions[]` body, write `condition_tree` on the rule, and replace `automation_rule_actions` rows (delete-then-insert) so drag-reorder persists.

### Step 8.1 — Write the failing test (append to existing file)

Append a case to `tests/api/automation.test.ts` (mirror its existing auth-mock setup; the file already mocks `@/lib/auth/config` with a `__set` helper — reuse it):

```ts
describe('POST /api/automation/rules — tree + ordered actions', () => {
  it('persists condition_tree and ordered automation_rule_actions', async () => {
    __set({ userId, workspaceId, role: 'admin' });
    const { POST } = await import('@/app/api/automation/rules/route');
    const res = await POST(
      new Request('http://t/api/automation/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Ordered',
          triggerEvent: 'row.created',
          condition: { property: 'row.id', operator: 'equals', value: 'x' },
          conditionTree: { logic: 'and', children: [{ field: 'row.id', op: 'equals', value: 'x' }] },
          actionType: 'notify',
          actionConfig: { userId },
          actions: [
            { type: 'notify', config: { userId }, sortOrder: 0 },
            { type: 'send_webhook', config: { webhookId: 'w1' }, sortOrder: 1 },
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as { id: string; conditionTree: unknown };
    expect(row.conditionTree).toEqual({ logic: 'and', children: [{ field: 'row.id', op: 'equals', value: 'x' }] });
    const actions = await db
      .select()
      .from(schema.automationRuleActions)
      .where(eq(schema.automationRuleActions.ruleId, row.id))
      .orderBy(asc(schema.automationRuleActions.sortOrder));
    // One row from the INSERT trigger (sort_order 0) is replaced by the explicit set.
    expect(actions.map((a) => a.actionType)).toEqual(['notify', 'send_webhook']);
  });
});
```

Add `asc` to the drizzle import at the top of the test file if absent.

### Step 8.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/api/automation.test.ts
```
Expected: FAIL — `conditionTree` not persisted (column never set) and ordered actions not replaced.

### Step 8.3 — Implementation

In `src/app/api/automation/rules/route.ts`, extend the Zod schema and the insert. Add to `RuleInput`:

```ts
  conditionTree: z.record(z.string(), z.unknown()).nullish(),
  actions: z
    .array(
      z.object({
        type: z.enum(ACTION_TYPES),
        config: z.record(z.string(), z.unknown()),
        sortOrder: z.number().int().nonnegative(),
      }),
    )
    .optional(),
```

In `POST`, after the existing `.returning()` that yields `row`, persist the tree (it's part of the insert) and replace ordered actions. Change the insert `.values({...})` to include:

```ts
        conditionTree: (body.conditionTree ?? null) as schema.AutomationRule['conditionTree'],
```

Then, after the insert returns `row`, replace the trigger-backfilled action row(s) with the explicit ordered set when provided:

```ts
    if (body.actions && body.actions.length > 0) {
      await getDb()
        .delete(schema.automationRuleActions)
        .where(eq(schema.automationRuleActions.ruleId, row.id));
      await getDb()
        .insert(schema.automationRuleActions)
        .values(
          body.actions.map((a) => ({
            ruleId: row.id,
            actionType: a.type,
            actionConfig: a.config,
            sortOrder: a.sortOrder,
          })),
        );
    }
```

Add `import { eq } from 'drizzle-orm';` (the file currently imports only `desc, eq` — confirm `eq` is present; it is).

Apply the same two changes to `src/app/api/automation/rules/[ruleId]/route.ts` PATCH: add `conditionTree` + `actions` to `RuleUpdate`, set `updateValues.conditionTree` when provided, and after a successful update replace the ordered-actions rows the same way (delete by `ruleId` then insert). Guard the action-replace so it only runs when `patch.actions` is provided.

### Step 8.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/api/automation.test.ts
```
Expected: PASS.

### Step 8.5 — Commit

```sh
git add src/app/api/automation/rules/route.ts src/app/api/automation/rules/[ruleId]/route.ts tests/api/automation.test.ts && git commit -m "feat(automation): API persists condition_tree + replaces ordered actions"
```

---

## Task 9 — Builder UI: recursive nested AND/OR groups

**Files:** Modify `src/components/automation/builder/condition-group.tsx`; Create `tests/components/automation/condition-group-nested.test.tsx`. Also update `src/components/automation/builder/rule-canvas.tsx` to pass the new `ConditionGroupModel` shape (the canvas already renders `<ConditionGroup group=... onChange=... />`).

The current `ConditionGroup` is a flat row list. Make it recursive: render child rows AND child groups, with an "Add group" button (guarded at depth cap), per-group AND/OR toggle, and remove buttons.

### Step 9.1 — Write the failing test

Create `tests/components/automation/condition-group-nested.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConditionGroup } from '@/components/automation/builder/condition-group';
import type { ConditionGroupModel } from '@/lib/automation/builder';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderGroup(group: ConditionGroupModel, onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ConditionGroup group={group} onChange={onChange} depth={0} />
    </I18nProvider>,
  );
}

it('adds a nested group when Add group is clicked', () => {
  const onChange = vi.fn();
  renderGroup({ id: 'g0', logic: 'and', children: [] }, onChange);
  fireEvent.click(screen.getByText('Add group'));
  const next = onChange.mock.calls[0][0] as ConditionGroupModel;
  expect(next.children).toHaveLength(1);
  expect((next.children[0] as ConditionGroupModel).logic).toBe('and');
});

it('renders the AND/OR toggle for a group with children', () => {
  renderGroup({
    id: 'g0',
    logic: 'or',
    children: [
      { id: 'c1', field: 'a', op: 'equals', value: '1' },
      { id: 'c2', field: 'b', op: 'equals', value: '2' },
    ],
  });
  const or = screen.getByRole('button', { name: 'OR' });
  expect(or.getAttribute('aria-pressed')).toBe('true');
});

it('hides Add group at the depth cap', () => {
  renderGroup({ id: 'g', logic: 'and', children: [] }, vi.fn());
  // depth=5 is the cap; render directly at the cap and assert the button is gone.
  cleanup();
  render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ConditionGroup group={{ id: 'g', logic: 'and', children: [] }} onChange={vi.fn()} depth={5} />
    </I18nProvider>,
  );
  expect(screen.queryByText('Add group')).toBeNull();
});
```

### Step 9.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/components/automation/condition-group-nested.test.tsx
```
Expected: FAIL — `ConditionGroup` has no `depth` prop / no "Add group" button / old `group.rows` shape.

### Step 9.3 — Implementation

Rewrite `src/components/automation/builder/condition-group.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AutomationOperator } from '@/db/schema';
import type { ConditionGroupModel, ConditionRow } from '@/lib/automation/builder';
import { MAX_CONDITION_TREE_DEPTH } from '@/lib/automation/condition-tree';
import { useT } from '@/lib/i18n/provider';

const OPERATORS: AutomationOperator[] = [
  'equals', 'not_equals', 'contains', 'not_contains', 'gt', 'lt', 'between',
  'is_empty', 'is_not_empty', 'is_true', 'is_false',
];

function parseLiteral(s: string): unknown {
  if (s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (!Number.isNaN(n) && s.trim() !== '') return n;
  return s;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Math.random().toString(36).slice(2)}`;
}

function isGroup(n: ConditionRow | ConditionGroupModel): n is ConditionGroupModel {
  return 'logic' in n && Array.isArray((n as ConditionGroupModel).children);
}

type Props = {
  group: ConditionGroupModel;
  onChange: (next: ConditionGroupModel) => void;
  depth: number;
};

export function ConditionGroup({ group, onChange, depth }: Props) {
  const t = useT();

  function setCombinator(logic: 'and' | 'or') {
    onChange({ ...group, logic });
  }
  function addRow() {
    onChange({ ...group, children: [...group.children, { id: newId(), field: '', op: 'equals', value: null }] });
  }
  function addGroup() {
    onChange({ ...group, children: [...group.children, { id: newId(), logic: 'and', children: [] }] });
  }
  function updateChild(id: string, next: ConditionRow | ConditionGroupModel) {
    onChange({ ...group, children: group.children.map((c) => (c.id === id ? next : c)) });
  }
  function removeChild(id: string) {
    onChange({ ...group, children: group.children.filter((c) => c.id !== id) });
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      {group.children.length > 1 ? (
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant={group.logic === 'and' ? 'default' : 'outline'}
            aria-pressed={group.logic === 'and'} onClick={() => setCombinator('and')}>
            {t('automation.builder.combinator.and')}
          </Button>
          <Button type="button" size="sm" variant={group.logic === 'or' ? 'default' : 'outline'}
            aria-pressed={group.logic === 'or'} onClick={() => setCombinator('or')}>
            {t('automation.builder.combinator.or')}
          </Button>
        </div>
      ) : null}

      {group.children.map((child) =>
        isGroup(child) ? (
          <div key={child.id} className="relative pl-2">
            <ConditionGroup
              group={child}
              depth={depth + 1}
              onChange={(next) => updateChild(child.id, next)}
            />
            <Button type="button" size="sm" variant="ghost" aria-label={t('automation.builder.removeGroup')}
              className="absolute right-1 top-1" onClick={() => removeChild(child.id)}>
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div key={child.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Input aria-label={t('automation.builder.condition.propertyPlaceholder')}
              placeholder={t('automation.builder.condition.propertyPlaceholder')}
              value={child.field}
              onChange={(e) => updateChild(child.id, { ...child, field: e.target.value })} />
            <Select value={child.op}
              onValueChange={(v) => updateChild(child.id, { ...child, op: v as AutomationOperator })}>
              <SelectTrigger aria-label={t('automation.builder.condition.operator')} className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
              </SelectContent>
            </Select>
            <Input aria-label={t('automation.builder.setProperty.value')}
              placeholder={t('automation.builder.setProperty.value')}
              value={child.value == null ? '' : String(child.value)}
              onChange={(e) => updateChild(child.id, { ...child, value: parseLiteral(e.target.value) })} />
            <Button type="button" size="sm" variant="ghost" aria-label={t('db.sort.remove')}
              onClick={() => removeChild(child.id)}>
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ),
      )}

      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          {t('automation.builder.addCondition')}
        </Button>
        {depth < MAX_CONDITION_TREE_DEPTH ? (
          <Button type="button" size="sm" variant="outline" onClick={addGroup}>
            {t('automation.builder.addGroup')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
```

In `src/components/automation/builder/rule-canvas.tsx`, update the `ConditionGroup` usage (line ~178) to pass `depth={0}`:

```tsx
          <ConditionGroup
            group={model.conditions}
            depth={0}
            onChange={(conditions) => setModel((m) => ({ ...m, conditions }))}
          />
```

Add the two new i18n keys in Task 12 (`automation.builder.addGroup`, `automation.builder.removeGroup`). The test passes against `en.json` only once those keys exist — so run Task 12 keys first OR add them inline now. To keep this task RED→GREEN clean, add the three keys to **all three** message files now (full JSON given in Task 12, Step 12.3) and `git add` them in this task's commit.

### Step 9.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/components/automation/condition-group-nested.test.tsx
```
Expected: PASS — 3 passed.

> The existing `tests/components/automation/condition-group.test.tsx` asserts the OLD flat `group.rows` shape and will now fail to compile/run. Update it to the new `children` shape, or delete the obsolete assertions (note in the commit). Re-run it: `pnpm vitest run tests/components/automation/condition-group.test.tsx`.

### Step 9.5 — Commit

```sh
git add src/components/automation/builder/condition-group.tsx src/components/automation/builder/rule-canvas.tsx tests/components/automation/condition-group-nested.test.tsx tests/components/automation/condition-group.test.tsx messages/en.json messages/es.json messages/ar.json && git commit -m "feat(automation): recursive nested AND/OR condition group UI"
```

---

## Task 10 — Builder UI: drag-reorder action cards

**Files:** Create `src/components/automation/builder/action-list.tsx`, `tests/components/automation/action-list-reorder.test.tsx`; Modify `src/components/automation/builder/rule-canvas.tsx` to render `ActionList` instead of the inline `.map` over actions.

Use `@dnd-kit/sortable` (already a project dep; same pattern as the db-table column reorder). The test asserts the reorder callback emits the new order; we don't simulate pointer drags in jsdom — instead we test the pure reorder via the exposed `onReorder` handler invoked by a keyboard-accessible move control, which is also the a11y fallback dnd-kit requires.

### Step 10.1 — Write the failing test

Create `tests/components/automation/action-list-reorder.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionList } from '@/components/automation/builder/action-list';
import type { ActionCard } from '@/lib/automation/builder';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const actions: ActionCard[] = [
  { id: 'a1', type: 'notify', config: { userId: 'u1' } },
  { id: 'a2', type: 'send_webhook', config: { webhookId: 'w1' } },
];

function renderList(onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ActionList actions={actions} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders one move-down control per non-last action', () => {
  renderList();
  expect(screen.getAllByLabelText('Move action down')).toHaveLength(1);
});

it('moving the first action down emits the swapped order', () => {
  const onChange = vi.fn();
  renderList(onChange);
  fireEvent.click(screen.getByLabelText('Move action down'));
  const next = onChange.mock.calls[0][0] as ActionCard[];
  expect(next.map((a) => a.id)).toEqual(['a2', 'a1']);
});
```

### Step 10.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/components/automation/action-list-reorder.test.tsx
```
Expected: FAIL — `Cannot find module '.../action-list'`.

### Step 10.3 — Implementation

Create `src/components/automation/builder/action-list.tsx`:

```tsx
'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical } from 'lucide-react';
import { ActionCardHost } from '@/components/automation/builder/action-card-host';
import { FlowConnector } from '@/components/automation/builder/flow-connector';
import { Button } from '@/components/ui/button';
import type * as schema from '@/db/schema';
import type { ActionCard } from '@/lib/automation/builder';
import { useT } from '@/lib/i18n/provider';

type Props = {
  actions: ActionCard[];
  onChange: (next: ActionCard[]) => void;
};

function SortableAction({
  action,
  index,
  isLast,
  onConfig,
  onMoveDown,
}: {
  action: ActionCard;
  index: number;
  isLast: boolean;
  onConfig: (next: { type: schema.AutomationActionType; config: Record<string, unknown> }) => void;
  onMoveDown: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: action.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style}>
      <FlowConnector variant="branch" />
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={t('automation.builder.dragAction')}
          className="mt-2 cursor-grab touch-none text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <ActionCardHost type={action.type} config={action.config} onChange={onConfig} />
        </div>
        {!isLast ? (
          <Button type="button" variant="ghost" size="sm" aria-label={t('automation.builder.moveActionDown')}
            onClick={onMoveDown}>
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ActionList({ actions, onChange }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = actions.findIndex((a) => a.id === active.id);
    const to = actions.findIndex((a) => a.id === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(actions, from, to));
  }

  function setConfigAt(index: number, next: { type: schema.AutomationActionType; config: Record<string, unknown> }) {
    onChange(actions.map((a, i) => (i === index ? { ...a, ...next } : a)));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={actions.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        {actions.map((action, i) => (
          <SortableAction
            key={action.id}
            action={action}
            index={i}
            isLast={i === actions.length - 1}
            onConfig={(next) => setConfigAt(i, next)}
            onMoveDown={() => onChange(arrayMove(actions, i, i + 1))}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
```

In `src/components/automation/builder/rule-canvas.tsx`, replace the inline `model.actions.map(...)` block (lines ~183-192) with:

```tsx
          <ActionList
            actions={model.actions}
            onChange={(actions) => setModel((m) => ({ ...m, actions }))}
          />
```

Add the import: `import { ActionList } from '@/components/automation/builder/action-list';` and remove the now-unused `ActionCardHost` + `FlowConnector` imports if they're no longer referenced elsewhere in the canvas (the trigger card still uses `FlowConnector` at line 176 — keep that import; `ActionCardHost` is now only used by `ActionList`, so remove it from the canvas). Also remove the `setActionAt` helper (moved into `ActionList`) and the `newActionId`/`addAction` stay (still used by the "Add action" button). When the body `save()` posts, include the ordered `actions` from `result.body.actions` so the API persists order (the canvas already spreads `...result.body`; since Task 7 added `actions` to the body, this is automatic — verify the POST body includes `actions`).

### Step 10.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/components/automation/action-list-reorder.test.tsx
```
Expected: PASS — 2 passed.

### Step 10.5 — Commit

```sh
git add src/components/automation/builder/action-list.tsx src/components/automation/builder/rule-canvas.tsx tests/components/automation/action-list-reorder.test.tsx && git commit -m "feat(automation): drag/keyboard-reorder action cards in the builder"
```

---

## Task 11 — Searchable templates gallery

**Files:** Modify `src/components/automation/builder/templates-gallery.tsx`, `src/lib/automation/templates.ts`; Create `tests/components/automation/templates-gallery-search.test.tsx`.

Replace the fixed 3-button grid with a searchable list that filters by name + description and shows ALL templates by default. Add a `descKey` to each template for search/display.

### Step 11.1 — Write the failing test

Create `tests/components/automation/templates-gallery-search.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TemplatesGallery } from '@/components/automation/builder/templates-gallery';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderGallery(onPick = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <TemplatesGallery onPick={onPick} />
    </I18nProvider>,
  );
}

it('shows a search box and all templates by default', () => {
  renderGallery();
  expect(screen.getByLabelText('Search templates')).toBeTruthy();
  expect(screen.getByText('Notify on high-priority row')).toBeTruthy();
  expect(screen.getByText('Auto-assign on @mention')).toBeTruthy();
  expect(screen.getByText('Archive when status = Done')).toBeTruthy();
});

it('filters by name', () => {
  renderGallery();
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'archive' } });
  expect(screen.getByText('Archive when status = Done')).toBeTruthy();
  expect(screen.queryByText('Notify on high-priority row')).toBeNull();
});

it('shows an empty message when nothing matches', () => {
  renderGallery();
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'zzzzz' } });
  expect(screen.getByText('No templates match your search.')).toBeTruthy();
});
```

### Step 11.2 — Run it to confirm RED

```sh
source ~/.zshenv && pnpm vitest run tests/components/automation/templates-gallery-search.test.tsx
```
Expected: FAIL — no search box exists.

### Step 11.3 — Implementation

In `src/lib/automation/templates.ts`, add a `descKey` to the `BuilderTemplate` type and each template, and update the `build()` shapes to the new recursive `conditions` model (the old `rows`/`combinator` shape no longer matches `BuilderModel`):

```ts
import type { BuilderModel } from '@/lib/automation/builder';

export type BuilderTemplate = {
  id: string;
  /** i18n key for the gallery label. */
  nameKey: string;
  /** i18n key for the gallery description (searchable). */
  descKey: string;
  build: () => BuilderModel;
};

function leaf(field: string, op: BuilderModel['conditions']['children'][number] extends infer _ ? any : never, value: unknown) {
  return { id: `c-${field}`, field, op, value };
}

export const BUILDER_TEMPLATES: BuilderTemplate[] = [
  {
    id: 'notify-high-priority',
    nameKey: 'automation.builder.templates.notifyHighPriority',
    descKey: 'automation.builder.templates.notifyHighPriorityDesc',
    build: () => ({
      triggerEvent: 'row.created',
      conditions: { id: 'g', logic: 'and', children: [{ id: 'c1', field: 'row.cells.priority', op: 'equals', value: 'High' }] },
      actions: [{ id: 'a1', type: 'notify', config: {} }],
    }),
  },
  {
    id: 'auto-assign-mention',
    nameKey: 'automation.builder.templates.autoAssignMention',
    descKey: 'automation.builder.templates.autoAssignMentionDesc',
    build: () => ({
      triggerEvent: 'comment.created',
      conditions: { id: 'g', logic: 'and', children: [] },
      actions: [{ id: 'a1', type: 'set_property', config: {} }],
    }),
  },
  {
    id: 'archive-on-done',
    nameKey: 'automation.builder.templates.archiveOnDone',
    descKey: 'automation.builder.templates.archiveOnDoneDesc',
    build: () => ({
      triggerEvent: 'row.updated',
      conditions: { id: 'g', logic: 'and', children: [{ id: 'c1', field: 'row.cells.status', op: 'equals', value: 'Done' }] },
      actions: [{ id: 'a1', type: 'set_property', config: {} }],
    }),
  },
];
```

> Simplify the `leaf` helper — the conditional type above is awkward. Use a plain typed helper instead:
> ```ts
> import type { AutomationOperator } from '@/db/schema';
> function leaf(field: string, op: AutomationOperator, value: unknown) {
>   return { id: `c-${field}`, field, op, value };
> }
> ```
> (The templates above inline the leaves directly, so the helper is optional — keep whichever is cleaner; the inlined version shown is self-contained.)

Rewrite `src/components/automation/builder/templates-gallery.tsx`:

```tsx
'use client';

import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BuilderModel } from '@/lib/automation/builder';
import { BUILDER_TEMPLATES } from '@/lib/automation/templates';
import { useT } from '@/lib/i18n/provider';

type Props = {
  onPick: (model: BuilderModel) => void;
};

export function TemplatesGallery({ onPick }: Props) {
  const t = useT();
  const searchId = useId();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUILDER_TEMPLATES;
    return BUILDER_TEMPLATES.filter((tpl) => {
      const hay = `${t(tpl.nameKey)} ${t(tpl.descKey)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, t]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('automation.builder.templates.title')}</h3>
      <Input
        id={searchId}
        aria-label={t('automation.builder.templates.search')}
        placeholder={t('automation.builder.templates.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('automation.builder.templates.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((tpl) => (
            <Button
              key={tpl.id}
              type="button"
              variant="outline"
              className="h-auto w-full flex-col items-start justify-start whitespace-normal py-2 text-left text-sm"
              onClick={() => onPick(tpl.build())}
            >
              <span className="font-medium">{t(tpl.nameKey)}</span>
              <span className="text-xs text-muted-foreground">{t(tpl.descKey)}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
```

> The existing `tests/components/automation/templates-gallery.test.tsx` and `tests/lib/automation/templates.test.ts` reference the old shape (`conditions.rows`/`combinator`, no `descKey`). Update them to the new shape (it now has `descKey` and `conditions.children`). Re-run both after this change.

The new keys (`automation.builder.templates.search`, `.empty`, and the three `*Desc` keys) are added in Task 12; add them to all three message files now so this test passes, and `git add` them here.

### Step 11.4 — Run it to confirm GREEN

```sh
source ~/.zshenv && pnpm vitest run tests/components/automation/templates-gallery-search.test.tsx tests/components/automation/templates-gallery.test.tsx tests/lib/automation/templates.test.ts
```
Expected: all PASS.

### Step 11.5 — Commit

```sh
git add src/components/automation/builder/templates-gallery.tsx src/lib/automation/templates.ts tests/components/automation/templates-gallery-search.test.tsx tests/components/automation/templates-gallery.test.tsx tests/lib/automation/templates.test.ts messages/en.json messages/es.json messages/ar.json && git commit -m "feat(automation): searchable templates gallery with descriptions"
```

---

## Task 12 — i18n keys (en/es/ar) consolidation + verify

**Files:** Modify `messages/en.json`, `messages/es.json`, `messages/ar.json`; Create `tests/i18n/automation-g5-keys.test.ts`.

Tasks 9 and 11 instructed adding keys inline. This task makes the full key set explicit, ensures all three locales have them, and adds a guard test. If a key was already added in an earlier task, this task only verifies its presence.

### Step 12.1 — Write the failing test

Create `tests/i18n/automation-g5-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';

const KEYS = [
  'automation.builder.addGroup',
  'automation.builder.removeGroup',
  'automation.builder.dragAction',
  'automation.builder.moveActionDown',
  'automation.builder.templates.search',
  'automation.builder.templates.empty',
  'automation.builder.templates.notifyHighPriorityDesc',
  'automation.builder.templates.autoAssignMentionDesc',
  'automation.builder.templates.archiveOnDoneDesc',
];

describe('G5 automation i18n keys', () => {
  for (const locale of ['en', 'es', 'ar'] as const) {
    it(`${locale} has every new key, non-empty`, () => {
      const m = getMessages(locale) as Record<string, string>;
      for (const k of KEYS) {
        expect(m[k], `${locale} missing ${k}`).toBeTruthy();
      }
    });
  }
});
```

### Step 12.2 — Run it to confirm RED (or partial)

```sh
source ~/.zshenv && pnpm vitest run tests/i18n/automation-g5-keys.test.ts
```
Expected: FAIL for any locale missing a key (es/ar most likely, if earlier tasks only touched en).

### Step 12.3 — Implementation

Add these key/value pairs to `messages/en.json` (alongside the existing `automation.builder.*` block, ~line 415):

```json
  "automation.builder.addGroup": "Add group",
  "automation.builder.removeGroup": "Remove group",
  "automation.builder.dragAction": "Drag to reorder action",
  "automation.builder.moveActionDown": "Move action down",
  "automation.builder.templates.search": "Search templates",
  "automation.builder.templates.empty": "No templates match your search.",
  "automation.builder.templates.notifyHighPriorityDesc": "Send a notification when a high-priority row is created.",
  "automation.builder.templates.autoAssignMentionDesc": "Assign a property when someone is @mentioned in a comment.",
  "automation.builder.templates.archiveOnDoneDesc": "Set a property to archive a row when its status becomes Done."
```

Add to `messages/es.json`:

```json
  "automation.builder.addGroup": "Añadir grupo",
  "automation.builder.removeGroup": "Eliminar grupo",
  "automation.builder.dragAction": "Arrastra para reordenar la acción",
  "automation.builder.moveActionDown": "Mover acción hacia abajo",
  "automation.builder.templates.search": "Buscar plantillas",
  "automation.builder.templates.empty": "Ninguna plantilla coincide con tu búsqueda.",
  "automation.builder.templates.notifyHighPriorityDesc": "Envía una notificación cuando se crea una fila de alta prioridad.",
  "automation.builder.templates.autoAssignMentionDesc": "Asigna una propiedad cuando se menciona a alguien con @ en un comentario.",
  "automation.builder.templates.archiveOnDoneDesc": "Establece una propiedad para archivar una fila cuando su estado pasa a Hecho."
```

Add to `messages/ar.json`:

```json
  "automation.builder.addGroup": "إضافة مجموعة",
  "automation.builder.removeGroup": "إزالة المجموعة",
  "automation.builder.dragAction": "اسحب لإعادة ترتيب الإجراء",
  "automation.builder.moveActionDown": "نقل الإجراء للأسفل",
  "automation.builder.templates.search": "ابحث في القوالب",
  "automation.builder.templates.empty": "لا توجد قوالب تطابق بحثك.",
  "automation.builder.templates.notifyHighPriorityDesc": "أرسل إشعارًا عند إنشاء صف ذي أولوية عالية.",
  "automation.builder.templates.autoAssignMentionDesc": "عيّن خاصية عند الإشارة إلى شخص بعلامة @ في تعليق.",
  "automation.builder.templates.archiveOnDoneDesc": "عيّن خاصية لأرشفة صف عندما تصبح حالته مكتملة."
```

(If any of these keys were already added in Task 9/11, do not duplicate them — JSON keys must be unique. Verify with `pnpm i18n:check`.)

### Step 12.4 — Run it to confirm GREEN + i18n audit

```sh
source ~/.zshenv && pnpm vitest run tests/i18n/automation-g5-keys.test.ts && pnpm i18n:check
```
Expected: i18n test 3 passed; `pnpm i18n:check` reports no NEW missing/unused keys (all added keys are referenced via `useT()` in the components).

### Step 12.5 — Commit

```sh
git add messages/en.json messages/es.json messages/ar.json tests/i18n/automation-g5-keys.test.ts && git commit -m "feat(automation): en/es/ar i18n keys for nested groups, action reorder, template search"
```

---

## Task 13 — G5 verification gate

**Files:** none (verification only). No code changes — if any command fails, fix in a follow-up task before declaring G5 done. Follow `superpowers:verification-before-completion`: run each command, paste real output, do not claim pass without evidence.

### Step 13.1 — Lint (0 errors)

```sh
source ~/.zshenv && pnpm lint
```
Expected: Biome reports 0 errors. (Auto-fixes for import ordering / `import type` are expected — accept them, then re-run until clean.)

### Step 13.2 — Typecheck

```sh
source ~/.zshenv && pnpm typecheck
```
Expected: `tsc --noEmit` exits 0, no output.

### Step 13.3 — i18n check (no new keys flagged)

```sh
source ~/.zshenv && pnpm i18n:check
```
Expected: no NEW missing or unused keys reported.

### Step 13.4 — G5 vitest suite

```sh
source ~/.zshenv && pnpm vitest run tests/lib/automation tests/db/automation-condition-tree-migration.test.ts tests/api/automation.test.ts tests/components/automation
```
Expected: all automation lib/db/api/component suites PASS (includes the legacy `dispatcher.test.ts`, `builder.test.ts`, `condition-group.test.tsx`, `templates-gallery.test.tsx` updated in earlier tasks, plus the 9 new G5 test files).

### Step 13.5 — Build

```sh
source ~/.zshenv && pnpm build; echo "BUILD_EXIT=$?"
```
Expected: `BUILD_EXIT=0` (the in-build TS phase is skipped per the v0.9.7 fix — types are gated by Step 13.2). If the self-hosted runner OOM/SIGKILLs (137/255), re-run; that is CI flake, not a code failure.

### Step 13.6 — Commit (gate marker, only if any fixups were needed)

If Steps 13.1–13.5 required no changes, there is nothing to commit. If a lint auto-fix or small fixup touched files:

```sh
git add -A && git commit -m "chore(automation): G5 verification gate fixups (lint/typecheck/build)"
```

---

## Reconciliation notes for the implementer (read before Task 1)

The shipped code diverges from the spec's idealized model — these decisions are baked into the tasks above:

1. **Table is `automation_rules`, not "automations".** Singular `condition`/`actionType`/`actionConfig` + a `builder` editor blob (migration 0056). The plan **adds** `condition_tree` (Task 3/4) and a new `automation_rule_actions` ordered-actions table (Task 3/4) rather than mutating the singular columns — the singular columns stay as the legacy/back-compat path and the dispatcher prefers the new fields with a fallback.
2. **`automation_runs` already exists** with `(ruleId, triggerPayload, status[success|failed|condition_unmet], error, createdAt)`. The spec's proposed `started_at/finished_at/trigger_digest` + `success|error|skipped` enum is **superseded** — do NOT rename or recreate the table. Migration 0061 only adds a retention index; pruning is in `run-retention.ts` (Task 6). The run-history UI/API/lib already exist.
3. **Migration numbers:** this plan owns 0058 (condition_tree), 0059 (ordered actions), 0061 (retention index). 0060 belongs to G6 (`chat_oauth_installs`) — skip it here. Every new `.sql` needs a `_journal.json` entry (Drizzle keys on the journal).
4. **Removing obsolete tests:** Tasks 7/9/11 intentionally change behavior (multi-condition + multi-action now allowed; recursive group shape; searchable gallery). The existing `builder.test.ts`, `condition-group.test.tsx`, `templates-gallery.test.tsx`, `templates.test.ts` assert the OLD shape and MUST be updated in-place in those tasks — the gate (Task 13) re-runs them green.
