# P05 — /my-tasks Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Title-case the filter tabs, give the active filter an obvious selected state, and replace the terse empty state with a friendlier one + CTA.

**Architecture:** All changes in `src/app/(app)/my-tasks/tasks-table.tsx`. (The native date input is handled in P01 Task 4 — do P01 first.)

**Tech Stack:** React 19 client component, Tailwind v4, shadcn `Button`.

**Covers:** GH #24 (a15 lowercase tabs), #25 (a16 active state), #26 (a17 empty state).

---

### Task 1: Title-case tabs + strong active state (#24, #25)

**Files:**
- Modify: `src/app/(app)/my-tasks/tasks-table.tsx` (filter buttons ~L63-72)
- Test: `tests/components/my-tasks-filters.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TasksTable } from '@/app/(app)/my-tasks/tasks-table';

afterEach(cleanup);

describe('my-tasks filter tabs', () => {
  it('renders Title-Case labels and marks the active filter with aria-pressed', () => {
    render(<TasksTable tasks={[]} status="open" {/* minimal real props */} as never />);
    const open = screen.getByRole('button', { name: 'Open' });
    expect(open).toBeTruthy();
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
  });
});
```

Read `tasks-table.tsx` for the real prop names (the active status prop, the tasks prop) and fill them into the render.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/my-tasks-filters.test.tsx`
Expected: FAIL — labels are lowercase / no `aria-pressed`.

- [ ] **Step 3: Implement**

For each filter button (open/done/all), render a Title-Case label and a clear active state. Map value→label: `{ open: 'Open', done: 'Done', all: 'All' }`. Use the shadcn `Button` with the active one in the default/primary variant and inactive ones in `ghost`/`outline`, plus `aria-pressed={status === value}`:

```tsx
{(['open', 'done', 'all'] as const).map((value) => (
  <Button
    key={value}
    type="button"
    variant={status === value ? 'default' : 'ghost'}
    size="sm"
    aria-pressed={status === value}
    onClick={() => setStatus(value)}
  >
    {{ open: 'Open', done: 'Done', all: 'All' }[value]}
  </Button>
))}
```

Preserve the existing navigation/query-param behavior the buttons currently trigger (wire `onClick` to whatever handler exists — `setStatus` is a placeholder).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/my-tasks-filters.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/my-tasks/tasks-table.tsx tests/components/my-tasks-filters.test.tsx
git commit -m "polish(my-tasks): Title-Case filter tabs + clear active state — Closes #24 Closes #25"
```

---

### Task 2: Friendlier empty state (#26)

**Files:**
- Modify: `src/app/(app)/my-tasks/tasks-table.tsx` (empty state ~L82-84)

- [ ] **Step 1: Replace "No tasks." with an illustrated empty state + CTA**

If a shared empty-state component exists (audit/v0.8 added `src/components/empty-state/*` — check `tests/components/empty-state/variants.test.tsx`), reuse it. Otherwise inline:

```tsx
<li className="flex flex-col items-center gap-2 py-10 text-center">
  <CheckSquare className="h-8 w-8 text-muted-foreground" aria-hidden />
  <p className="text-sm font-medium">No tasks yet</p>
  <p className="max-w-xs text-sm text-muted-foreground">
    Tasks you add inside pages show up here. Open a page and add a to-do to get started.
  </p>
</li>
```

Prefer the shared `EmptyState` component if present (read the file to confirm its props) — keep the suite DRY.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. Visual check with zero tasks.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/my-tasks/tasks-table.tsx
git commit -m "polish(my-tasks): friendlier empty state with guidance — Closes #26"
```

---

## Self-Review

- Covers #24, #25, #26. ✓
- Active state TDD'd via `aria-pressed`. ✓
- Reuses shared `EmptyState` if it exists (DRY) — implementer verifies. ✓
- Date control intentionally excluded (P01). ✓
