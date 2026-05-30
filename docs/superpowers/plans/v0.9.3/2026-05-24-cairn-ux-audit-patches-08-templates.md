# P08 — Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ensure built-in templates appear in the gallery (seed + listing), and add a discoverable "Save as template" CTA on the templates page itself.

**Architecture:** `src/lib/templates/builtins.ts` (`BUILTINS`, `seedBuiltinTemplates`), `src/lib/templates/access.ts` (`listVisibleTemplates`), `src/app/(app)/templates/page.tsx`, `src/components/templates/templates-gallery.tsx`, plus the entrypoint seed call (`src/server/entrypoint.ts`). The existing save-as-template flow lives in `page-menu.tsx` + `save-as-template-dialog.tsx` + `POST /api/templates/save-from-page`.

**Tech Stack:** Drizzle ORM, Postgres, Next.js RSC, Vitest + Testcontainers.

**Covers:** GH #36 (a27 no built-ins), #37 (a28 no save CTA).

---

### Task 1: Diagnose why built-ins don't appear (#36)

**Files:**
- Reference: `src/lib/templates/builtins.ts`, `src/lib/templates/access.ts`, `src/server/entrypoint.ts`, `src/app/(app)/templates/page.tsx`
- Test: `tests/lib/templates/list-builtins.test.ts` (Testcontainers)

- [ ] **Step 1: Reproduce with a failing integration test**

Write a Testcontainers test (follow the existing `tests/helpers/db.ts` pattern) that: runs migrations, calls `seedBuiltinTemplates()`, then calls `listVisibleTemplates()` for a fresh workspace/user and asserts the four built-ins are returned.

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres, getTestDb, truncateAll } from '@/tests/helpers/db'; // match real helper exports
import { seedBuiltinTemplates } from '@/lib/templates/builtins';
import { listVisibleTemplates } from '@/lib/templates/access';

beforeAll(startPostgres);
afterAll(stopPostgres);
beforeEach(truncateAll);

describe('built-in templates listing', () => {
  it('lists seeded built-ins for a workspace', async () => {
    await seedBuiltinTemplates();
    const rows = await listVisibleTemplates(/* workspaceId, userId, role — real signature */);
    const names = rows.map((r) => r.name);
    expect(names).toContain('Welcome to Cairn');
    expect(names).toContain('Meeting notes');
  });
});
```

Read the real signatures of `seedBuiltinTemplates` and `listVisibleTemplates` (args: workspaceId? userId? role?) and the helper exports before finalizing.

- [ ] **Step 2: Run it — identify the gap**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/templates/list-builtins.test.ts`
Two likely failures:
- **Seed gap:** `seedBuiltinTemplates()` is never called at startup → built-ins absent in a real deploy. Confirm whether `src/server/entrypoint.ts` calls it; if not, that's the prod bug.
- **Listing/ACL gap:** built-ins are seeded with `workspaceId IS NULL` + `builtIn=true`, but `listVisibleTemplates` filters by `workspaceId = $current` and drops the null-workspace built-ins.

- [ ] **Step 3: Fix whichever gap(s) the test exposes**

- If seed isn't wired at startup: add `await seedBuiltinTemplates();` to `src/server/entrypoint.ts` (after migrations, idempotent — it upserts on `(name, built_in=true, workspace_id IS NULL)`).
- If listing drops built-ins: extend `listVisibleTemplates` so the query also returns rows where `builtIn = true AND workspaceId IS NULL` (union with the workspace-scoped + visibility-tier rows). Keep ACL correct (built-ins are global/public-readable).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/templates/list-builtins.test.ts`
Expected: PASS — built-ins listed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates/access.ts src/server/entrypoint.ts tests/lib/templates/list-builtins.test.ts
git commit -m "fix(templates): seed + list built-in templates in the gallery — Closes #36"
```

---

### Task 2: "Save as template" CTA on the templates page (#37)

**Files:**
- Modify: `src/app/(app)/templates/page.tsx` and/or `src/components/templates/templates-gallery.tsx`
- Reference: existing flow `src/components/pages/save-as-template-dialog.tsx`, `POST /api/templates/save-from-page`

- [ ] **Step 1: Add a discoverable CTA / guidance**

The only current path is the per-page `…` menu. Add a CTA on the templates page header that explains/launches the flow. Since "save as template" needs a source page, the cleanest CTA is guidance + a deep link: a button/card "Save a page as a template" that explains it's available from any page's `…` menu, OR — if a recent/current page id is readily available — open the existing `SaveAsTemplateDialog` directly.

Minimal, dependency-light version (guidance card in the gallery header):

```tsx
<div className="mb-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
  <p className="font-medium text-foreground">Create your own template</p>
  <p className="mt-1">
    Open any page, click the <span className="font-medium">⋯</span> menu, and choose
    <span className="font-medium"> “Save as template…”</span> to add it here.
  </p>
</div>
```

If wiring a live launcher is straightforward (a client gallery component already exists), prefer mounting `SaveAsTemplateDialog` behind a "Save current page…" button when a page context is available. Keep it simple; guidance is acceptable.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. In `pnpm dev`, the templates page shows the CTA/guidance.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/templates/page.tsx" src/components/templates/templates-gallery.tsx
git commit -m "feat(templates): discoverable Save as template CTA on the gallery — Closes #37"
```

---

## Self-Review

- Covers #36, #37. ✓
- #36 is TDD'd against real Postgres (the audit "no built-ins" is a real seed/listing bug — the test pins it). ✓
- #37 offers a low-risk guidance CTA with an optional live-launcher upgrade. ✓
- Real signatures (seed/list/helpers) flagged to read before finalizing the test. ✓
