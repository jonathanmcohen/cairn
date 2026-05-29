# P06 — /notifications Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the Mentions/Replies pills clear toggle semantics + active state, add a friendly "caught up" empty state, and add coverage verifying the bell drawer renders and links to `/notifications`.

**Architecture:** Changes in `src/components/notifications/page-list.tsx` (pills, empty state) and `src/components/notifications/drawer.tsx` + `bell.tsx` (verification test). (The native status select + date filters are handled in P01 Task 5 — do P01 first.)

**Tech Stack:** React 19 client components, Tailwind v4, SWR.

**Covers:** GH #30 (a21 pills), #31 (a22 empty state), #40 (a31 bell drawer verify).

---

### Task 1: Mentions/Replies pills — toggle semantics + active state (#30)

**Files:**
- Modify: `src/components/notifications/page-list.tsx` (type-filter pills ~L191-192)
- Test: `tests/components/notifications-pills.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationsPageList } from '@/components/notifications/page-list';

afterEach(cleanup);

describe('notifications type pills', () => {
  it('exposes pressed state on the Mentions/Replies toggles', () => {
    render(<NotificationsPageList initialItems={[]} {/* minimal real props */} as never />);
    const mentions = screen.getByRole('button', { name: /mentions/i });
    expect(mentions.getAttribute('aria-pressed')).toBeTypeOf('string');
  });
});
```

Read the file for the real export name + props (`NotificationsPageList`) and the type-filter state.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/notifications-pills.test.tsx`
Expected: FAIL — no `aria-pressed` on the pills.

- [ ] **Step 3: Implement toggle styling + semantics**

Make each pill a toggle: `aria-pressed={isActive}`, active = filled/primary, inactive = outline/muted:

```tsx
<button
  type="button"
  aria-pressed={typeFilter === 'mention'}
  onClick={() => toggleType('mention')}
  className={cn(
    'rounded-full border px-3 py-1 text-sm transition-colors',
    typeFilter === 'mention'
      ? 'border-transparent bg-primary text-primary-foreground'
      : 'border-input bg-background text-muted-foreground hover:bg-accent',
  )}
>
  Mentions
</button>
```

Repeat for Replies. Use the real state var/handler names from the file. Import `cn` from `@/lib/utils` if not already.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/notifications-pills.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/page-list.tsx tests/components/notifications-pills.test.tsx
git commit -m "polish(notifications): toggle semantics + active state for type pills — Closes #30"
```

---

### Task 2: "You're all caught up" empty state (#31)

**Files:**
- Modify: `src/components/notifications/page-list.tsx` (list/empty branch ~L237+)

- [ ] **Step 1: Add an empty branch when there are no items**

```tsx
{items.length === 0 ? (
  <div className="flex flex-col items-center gap-2 py-12 text-center">
    <BellOff className="h-8 w-8 text-muted-foreground" aria-hidden />
    <p className="text-sm font-medium">You’re all caught up</p>
    <p className="max-w-xs text-sm text-muted-foreground">
      New mentions and replies will appear here.
    </p>
  </div>
) : (
  /* existing list */
)}
```

Reuse the shared `EmptyState` component if present (check `src/components/empty-state/`). Import `BellOff` from lucide-react.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. Visual check with zero notifications.

- [ ] **Step 3: Commit**

```bash
git add src/components/notifications/page-list.tsx
git commit -m "polish(notifications): friendly caught-up empty state — Closes #31"
```

---

### Task 3: Verify bell drawer renders + links to /notifications (#40)

**Files:**
- Test: `tests/components/notifications-drawer.test.tsx`
- Reference: `src/components/notifications/drawer.tsx` ("See all" → /notifications ~L219), `src/components/notifications/bell.tsx`

- [ ] **Step 1: Write the verification test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationDrawer } from '@/components/notifications/drawer';

afterEach(cleanup);

describe('notification drawer', () => {
  it('renders when open and links to /notifications', () => {
    render(<NotificationDrawer open onOpenChange={() => {}} onMarked={() => {}} />);
    const seeAll = screen.getByRole('link', { name: /see all/i });
    expect(seeAll.getAttribute('href')).toBe('/notifications');
  });
});
```

Match the real prop names from `drawer.tsx` (`open`, `onOpenChange`, `onMarked`). If the drawer fetches via SWR on open, the "See all" footer link should still render synchronously; if the test needs the fetch mocked, stub `fetch`/SWR minimally so the shell renders.

- [ ] **Step 2: Run it**

Run: `source ~/.zshenv && pnpm vitest run tests/components/notifications-drawer.test.tsx`
Expected: PASS if the drawer already renders the "See all" link (verification). If it FAILS because the link text/href differs, that is a real finding — fix the drawer to link to `/notifications` and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/components/notifications-drawer.test.tsx src/components/notifications/drawer.tsx
git commit -m "test(notifications): verify bell drawer renders + links to /notifications — Closes #40"
```

---

## Self-Review

- Covers #30, #31, #40. ✓
- Pills TDD'd via `aria-pressed`; drawer verified via render test. ✓
- Status select + date filters excluded (P01). ✓
- Reuses shared `EmptyState` where available (DRY). ✓
