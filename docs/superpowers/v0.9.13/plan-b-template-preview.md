# v0.9.13 Plan B — Template preview 500 (#134)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax: failing test → red → impl → green → commit.
>
> ⛔ HOLD — this is plan-only. No code until explicit GO. Branch `patches/v0.9.13` (already checked out). Every shell command MUST be prefixed with `source ~/.zshenv && ` (the Bash tool does not auto-source it; Homebrew/node/pnpm/docker are off-PATH otherwise).

> **IMPLEMENTER NOTE — systematic-debugging discipline:** you MUST run the repro test in Task 1 first and confirm the exact failure mode before writing any fix. The plan identifies the most likely root cause from static analysis; **verify it is actually what fails** before implementing. If the real failure differs from what is described, adjust the fix accordingly and note the discrepancy in the commit message. Do not assume — observe.

## Goal

Fix the runtime bug (#134) where opening the Preview drawer on a built-in template (e.g. "Meeting notes") in the template gallery shows the red "Could not load this preview" error. The route `GET /api/templates/[id]` exists and compiles; it fails at runtime for built-in templates. Reproduce the failure with an integration test before fixing.

## Architecture

**Call chain:**
```
TemplatePreviewDialog (client) → fetch /api/templates/[id]
  → GET route.ts
    → requireRole('viewer')           — throws 401 if unauthenticated
    → canReadTemplate(db, { templateId, viewerUserId, viewerWorkspaceId })
      → SELECT visibility, workspaceId FROM templates WHERE id = ?
      → if !tpl: return false          [already hardened — existing code]
      → if visibility === 'public': return true
      → if !workspaceId: return false  ← built-ins hit this branch
    → if !ok: 404
    → SELECT * FROM templates WHERE id = ?
    → buildTemplatePreview(tpl.payload)  [pure, won't throw]
    → 200 JSON
```

**Static analysis of the most likely root cause (confirm before fixing):**

`seedBuiltinTemplates` (`src/lib/templates/builtins.ts:211`) inserts built-in rows with no explicit `visibility` value — it relies on the column default. The Drizzle schema (`src/db/schema/templates.ts:25`) defines `visibility` as `notNull().default('workspace')`. The DB column default is therefore `'workspace'`, not `'public'`.

`canReadTemplate` (`src/lib/templates/access.ts`) handles a `'workspace'`-visibility row by checking whether the viewer is a member of the template's workspace. Built-in rows have `workspaceId = null`. The code at line 44 returns `false` when `!tpl.workspaceId` — so every built-in template ACL-check returns `false`, causing the route to respond 404. The `TemplatePreviewDialog` treats any non-2xx as an error and shows "Could not load this preview."

This means the bug is almost certainly a **404, not a 500** — but the scope doc says "500" because that is what the browser-sweep reporter saw. The exact status depends on the live state of the DB rows. A 500 could occur if the DB has no row at all for a built-in (failed or un-run seed) and there is a residual code path that throws — but `canReadTemplate` already guards `if (!tpl) return false`. Confirm the actual status code in Task 1 before deciding which of the following is the real fix:

- **Cause A (most likely):** `seedBuiltinTemplates` omits `visibility: 'public'` → rows seeded as `'workspace'` → `canReadTemplate` returns `false` → 404 → dialog shows error. **Fix:** add `visibility: 'public'` to the `db.insert(...).values({...})` call in `seedBuiltinTemplates`, and to the `db.update(...).set({...})` call so existing rows are healed on next startup.
- **Cause B (if rows are missing entirely):** seed never ran or the test DB was not migrated → no row → `canReadTemplate` returns `false` (404). **Fix:** same as A (the seed sets `visibility: 'public'`); ensure the test seeds before calling the handler.
- **Cause C (if status is 500):** an unexpected throw escapes the route's try/catch. Check the server logs for the actual error message; the route's catch block at line 43–50 returns the `err.message`. If cause A is confirmed, the dialog shows its error on 404 (not 2xx), not 500.

**Concrete fix after repro (for cause A/B):**

In `src/lib/templates/builtins.ts`:
- In the `else` branch (`db.insert`): add `visibility: 'public' as const` to the `.values({...})` object.
- In the `if (existing)` branch (`db.update`): add `visibility: 'public' as const` to the `.set({...})` object (heals existing seeded rows on next startup).

No schema migration needed — `visibility` column already exists with a CHECK constraint allowing `'public'`.

## Tech Stack

- Next.js 16 (App Router, TypeScript strict). Route: `src/app/api/templates/[id]/route.ts`.
- Drizzle ORM + Postgres 16 via Testcontainers. The test harness uses `tests/helpers/db.ts` `startPostgres` / `stopPostgres` with `runMigrations` via `src/db/migrate.ts`.
- Vitest 4 (Testcontainers integration tests). `vi.mock('@/lib/auth/config')` with a `__set` session helper (copy the exact pattern from `tests/api/templates/get.test.ts`).
- No new dependencies. No schema migration.

---

## File structure

```
docs/superpowers/v0.9.13/
  plan-b-template-preview.md          # this plan

src/lib/templates/
  builtins.ts                         # EDIT (Task 3) — add visibility: 'public' to insert + update

tests/api/templates/
  builtin-preview.test.ts             # NEW (Tasks 1 + 2) — repro + fix integration tests
```

---

## Task 1 — Reproduce the failure (RED integration test)

- [ ] Create `tests/api/templates/builtin-preview.test.ts` with the test harness copied from `tests/api/templates/get.test.ts` (same `vi.mock`, same `beforeAll`/`afterAll`/`beforeEach`, same `call` helper).
- [ ] Seed built-in templates by calling `seedBuiltinTemplates(getDb())` **without** passing any explicit `visibility` (mirror what startup does).
- [ ] Retrieve one seeded built-in's id from the DB (query by `builtIn = true, workspaceId IS NULL`).
- [ ] Call `GET /api/templates/[id]` as an authenticated viewer.
- [ ] Assert the **actual** status code. The test is deliberately written to print the body on failure so you can confirm whether the route 404s or 500s.
- [ ] Run it and confirm RED — capture the status and body in the test output before moving on.

### 1a. Failing test

Create `tests/api/templates/builtin-preview.test.ts`:

```ts
import { eq, isNull } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { seedBuiltinTemplates } from '@/lib/templates/builtins';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE templates, pages, workspace_members, workspaces, users, audit_log, sessions, accounts RESTART IDENTITY CASCADE`;
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function call(id: string): Promise<{ status: number; body: unknown }> {
  const { GET } = await import('@/app/api/templates/[id]/route');
  const res = await GET(new Request(`http://localhost/api/templates/${id}`), {
    params: Promise.resolve({ id }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET /api/templates/[id] — built-in templates (#134)', () => {
  // REPRO TEST — expected RED before Task 3 fix.
  // This test mirrors what the live app does: seed via seedBuiltinTemplates
  // (no explicit visibility), then fetch the built-in as an authenticated viewer.
  // It MUST fail before the fix so we confirm the real failure mode.
  it('REPRO: seeding without explicit visibility and fetching a built-in → currently fails (not 200)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    // Seed exactly as startup does — no explicit visibility passed.
    await seedBuiltinTemplates(getDb());
    // Retrieve any seeded built-in id.
    const [builtin] = await getDb()
      .select({ id: schema.templates.id, name: schema.templates.name, visibility: schema.templates.visibility })
      .from(schema.templates)
      .where(eq(schema.templates.builtIn, true))
      .limit(1);
    if (!builtin) throw new Error('seedBuiltinTemplates produced no rows — seed failed');
    await setUser(u.userId);
    const r = await call(builtin.id);
    // Log the actual outcome so the implementer can see the real failure mode.
    console.log(`[REPRO] name=${builtin.name} visibility=${builtin.visibility} status=${r.status} body=${JSON.stringify(r.body)}`);
    // This assertion will FAIL before the fix — the built-in currently cannot be previewed.
    // The test documents the symptom: the user sees "Could not load this preview" because
    // the fetch returns a non-2xx response.
    expect(r.status, `Built-in template "${builtin.name}" (visibility=${builtin.visibility}) should return 200 after fix`).toBe(200);
  });
});
```

### 1b. Run it — expect RED

```
source ~/.zshenv && pnpm vitest run tests/api/templates/builtin-preview.test.ts
```

Expected: test fails. The `console.log` line prints the actual `visibility` value and `status`. Confirm:
- If `visibility=workspace` and `status=404` → cause A confirmed (proceed as planned).
- If `status=500` → read the `body.error` string to find the thrown message; investigate the actual throw before fixing.
- If the seed throws and `builtin` is undefined → cause B (seed is broken; investigate `builtins.ts` separately).

**Do not proceed to Task 2 until you have read the console output and confirmed the failure mode.**

### 1c. Commit the repro test (RED)

```
source ~/.zshenv && git add tests/api/templates/builtin-preview.test.ts
source ~/.zshenv && git commit -m "test(templates): add repro test for built-in preview 500/404 (#134) [RED]"
```

---

## Task 2 — Add the passing-state assertion (still RED until fix)

- [ ] Extend the same test file with the assertion that must be GREEN after the fix: `seedBuiltinTemplates` with `visibility: 'public'` → 200 + valid `{id, name, kind, blocks}` shape.
- [ ] Also add a negative guard: a workspace template with `visibility: 'workspace'` in a foreign workspace still returns 404.

### 2a. Additional tests

Append to `tests/api/templates/builtin-preview.test.ts` (inside the same `describe` block):

```ts
  // GREEN CONTRACT: after the fix, a properly-seeded built-in (visibility='public')
  // is accessible to any authenticated viewer.
  it('a built-in seeded with visibility=public returns 200 + preview shape', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    // Seed a single built-in with the correct visibility (what the fix will produce).
    const [row] = await getDb()
      .insert(schema.templates)
      .values({
        name: 'Meeting notes',
        kind: 'page',
        workspaceId: null,
        builtIn: true,
        visibility: 'public',
        payload: {
          kind: 'page',
          rootPageId: 'mn-root',
          pages: [
            {
              id: 'mn-root',
              parentId: null,
              title: 'Meeting notes',
              icon: '📝',
              content: {
                type: 'doc',
                content: [
                  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Attendees' }] },
                ],
              },
            },
          ],
          databases: [],
        } as never,
      } as never)
      .returning({ id: schema.templates.id });
    if (!row) throw new Error('seed failed');
    await setUser(u.userId);
    const r = await call(row.id);
    expect(r.status).toBe(200);
    const body = r.body as { id: string; name: string; kind: string; blocks: unknown[] };
    expect(body.id).toBe(row.id);
    expect(body.name).toBe('Meeting notes');
    expect(body.kind).toBe('page');
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  // GUARD: workspace templates in a foreign workspace still 404 (ACL not relaxed).
  it('a workspace-visibility template in a foreign workspace is still 404', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [row] = await getDb()
      .insert(schema.templates)
      .values({
        name: 'Theirs',
        kind: 'page',
        workspaceId: owner.workspaceId,
        builtIn: false,
        visibility: 'workspace',
        payload: { kind: 'page', rootPageId: 'x', pages: [], databases: [] } as never,
      } as never)
      .returning({ id: schema.templates.id });
    if (!row) throw new Error('seed failed');
    const outsider = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser(outsider.userId);
    const r = await call(row.id);
    expect(r.status).toBe(404);
  });
```

### 2b. Run it — expect RED (first test still fails, others green)

```
source ~/.zshenv && pnpm vitest run tests/api/templates/builtin-preview.test.ts
```

The REPRO test (`visibility=workspace` seed → not 200) still fails. The two new tests pass (they already seed correctly). This is expected — the fix is in Task 3.

### 2c. Commit

```
source ~/.zshenv && git add tests/api/templates/builtin-preview.test.ts
source ~/.zshenv && git commit -m "test(templates): add green-contract + ACL-guard tests for built-in preview (#134)"
```

---

## Task 3 — Fix `seedBuiltinTemplates` to seed `visibility: 'public'` (GREEN)

The fix targets the root cause confirmed by Task 1: `seedBuiltinTemplates` inserts built-in rows without an explicit `visibility`, so they receive the column default `'workspace'`. `canReadTemplate` returns `false` for any `'workspace'` row whose `workspaceId` is null, causing 404. The fix is to set `visibility: 'public'` on every built-in upsert — on insert for new rows, on update to heal any previously-seeded rows.

**If Task 1 revealed a different root cause, stop here and adjust the fix accordingly before implementing.**

### 3a. Implementation

Edit `src/lib/templates/builtins.ts`.

In the `if (existing)` branch (the `db.update` call around line 205–208), add `visibility: 'public' as const` to the `.set({...})` object:

```ts
    if (existing) {
      await db
        .update(schema.templates)
        .set({ kind: b.kind, payload: b.payload, visibility: 'public' })
        .where(eq(schema.templates.id, existing.id));
    } else {
```

In the `else` branch (the `db.insert` call around line 210–217), add `visibility: 'public' as const` to the `.values({...})` object:

```ts
    } else {
      await db.insert(schema.templates).values({
        workspaceId: null,
        name: b.name,
        kind: b.kind,
        payload: b.payload,
        builtIn: true,
        visibility: 'public',
      });
    }
```

No other files change. `canReadTemplate` already returns `true` when `tpl.visibility === 'public'` (line 39) — no ACL change needed.

### 3b. Run tests — expect GREEN

```
source ~/.zshenv && pnpm vitest run tests/api/templates/builtin-preview.test.ts
```

All three tests must pass:
1. REPRO: `seedBuiltinTemplates` now sets `visibility='public'`, built-in is accessible → 200.
2. Public-seeded green contract → 200 + preview shape.
3. Workspace-visibility in foreign workspace → 404 (ACL unchanged).

### 3c. Commit

```
source ~/.zshenv && git add src/lib/templates/builtins.ts
source ~/.zshenv && git commit -m "fix(templates): seed built-in templates with visibility=public so preview route returns 200 (#134)"
```

---

## Gate Task — full verification

Run the complete gate in order. Every command must pass before claiming Plan B done. (Per superpowers:verification-before-completion — paste real terminal output; do not assert green without evidence.)

```
source ~/.zshenv && pnpm lint
```
Expect: Biome reports **0 errors**. The only changed production file is `builtins.ts`; the `visibility: 'public'` addition is a valid string literal that Biome will not flag. If Biome reorders imports or reformats, accept and re-run clean.

```
source ~/.zshenv && pnpm typecheck
```
Expect: `tsc --noEmit` exits 0. `'public'` is a valid `TemplateVisibility` (`'private' | 'workspace' | 'public'`); no type errors expected.

```
source ~/.zshenv && pnpm i18n:check
```
Expect: **no new findings** vs `i18n-audit.baseline.json`. Plan B adds no user-facing strings.

```
source ~/.zshenv && pnpm vitest run
```
Expect: full suite green. Requires Docker/Colima running for Testcontainers (`colima start` if the daemon is down). The three tests in `tests/api/templates/builtin-preview.test.ts` plus all pre-existing template tests must pass.

```
source ~/.zshenv && pnpm build
```
Expect: `next build` succeeds. The only changed file is `builtins.ts` (a lib helper, not a route); no route changes.

```
source ~/.zshenv && pnpm exec playwright test tests/a11y/
```
Expect: a11y gate passes. Plan B touches no UI components; no touch-target or accessibility regressions possible.

**Do NOT push and do NOT open a PR** — the human/controller integrates the branch.

---

## Notes / decisions

- **No schema migration.** The `visibility` column and its `CHECK ('private','workspace','public')` constraint landed in migration 0048 (v0.9.0 G4 P24/P25). Passing `visibility: 'public'` to an existing column is a data-only change applied by the startup seed, not a DDL change.
- **Healing existing deployments.** The `db.update(...).set({ ..., visibility: 'public' })` in the `if (existing)` branch means that on next container startup, any already-seeded built-in rows with `visibility='workspace'` are automatically healed. No manual SQL or one-off migration script is needed.
- **Why `canReadTemplate` is not the fix.** The function is correctly structured: `if (!tpl) return false` guards missing rows; `if (visibility === 'public') return true` would short-circuit for built-ins once they carry the correct visibility. The issue is upstream (bad seed data), not a logic error in the ACL. Patching `canReadTemplate` to special-case `builtIn=true` would be a second-order fix that hides the real data gap and complicates the ACL semantics.
- **Existing test parity.** `tests/api/templates/get.test.ts` already seeds built-ins with an explicit `visibility: 'public'` (line 103) — that is why its tests pass. The gap between that test and the live startup seed is exactly what this plan closes.
- **`canReadTemplate` defensive guard already present.** Line 38 of `access.ts` already contains `if (!tpl) return false`. No hardening of that function is needed (cause A/B both resolve to a 404 already, not a 500 from a thrown `Cannot read properties of undefined`). If Task 1 reveals an actual 500 from a throw, the implementer must locate the throw from the error body and address it before applying the visibility fix.
