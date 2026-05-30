# P04 — Routing & 404 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `/tasks` resolve to the tasks hub, and replace the bare Next.js default 404 with a themed app-root not-found page.

**Architecture:** Follow the established redirect pattern (an index `page.tsx` calling `redirect()` from `next/navigation`, as used by `/settings`). Add a root `src/app/not-found.tsx` that reuses app styling and links home.

**Tech Stack:** Next.js 16 App Router, `next/navigation`, Tailwind v4.

**Covers:** GH #22 (audit 13 — `/tasks` redirect), GH #23 (audit 14 — themed 404).

---

### Task 1: `/tasks` → `/my-tasks` redirect (#22)

**Files:**
- Create: `src/app/(app)/tasks/page.tsx`
- Test: `tests/app/tasks-redirect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

describe('/tasks route', () => {
  it('permanently redirects to /my-tasks', async () => {
    const mod = await import('@/app/(app)/tasks/page');
    expect(() => mod.default()).toThrow('REDIRECT:/my-tasks');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/app/tasks-redirect.test.ts`
Expected: FAIL — cannot find module `@/app/(app)/tasks/page`.

- [ ] **Step 3: Implement the redirect**

```tsx
import { permanentRedirect } from 'next/navigation';

export default function TasksRedirect(): never {
  permanentRedirect('/my-tasks');
}
```

Note: if the test mocks `redirect` (not `permanentRedirect`), align the mock to whichever is used. Prefer `permanentRedirect` (308) since the canonical path is `/my-tasks`. Update the test mock to export both `redirect` and `permanentRedirect`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/app/tasks-redirect.test.ts`
Expected: PASS (`REDIRECT:/my-tasks`).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/tasks/page.tsx" tests/app/tasks-redirect.test.ts
git commit -m "fix(routing): redirect /tasks -> /my-tasks — Closes #22"
```

---

### Task 2: Themed app-root 404 page (#23)

**Files:**
- Create: `src/app/not-found.tsx`
- Test: `tests/app/not-found.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NotFound from '@/app/not-found';

afterEach(cleanup);

describe('app-root <NotFound>', () => {
  it('renders a themed 404 with a link home', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeTruthy();
    const home = screen.getByRole('link', { name: /home|back/i });
    expect(home.getAttribute('href')).toBe('/');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/app/not-found.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the themed 404**

```tsx
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <p className="text-6xl font-bold tracking-tight text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">This page wandered off</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you’re looking for doesn’t exist or may have been moved.
      </p>
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
```

Note: a root `not-found.tsx` renders inside the root layout (`src/app/layout.tsx`), so the theme provider / fonts apply. Confirm the root layout wraps children in the `next-themes` provider; if the provider lives only in `(app)/layout.tsx`, the page still renders with default tokens (acceptable — tokens resolve via `:root`/`.dark` CSS). Verify the rendered page visually in both themes during Step 4.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/app/not-found.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; build clean. Manually hit a bogus URL (e.g. `/zzz-nope`) in `pnpm dev` and confirm themed render + working "Back to home" in light and dark.

- [ ] **Step 5: Commit**

```bash
git add src/app/not-found.tsx tests/app/not-found.test.tsx
git commit -m "feat(404): themed app-root not-found page with home link — Closes #23"
```

---

## Self-Review

- #22: redirect created + tested. ✓
- #23: themed root 404 + tested. ✓
- Both follow existing patterns (redirect index page; app-root not-found). ✓
- Open question flagged inline: whether the theme provider wraps the root layout — implementer verifies in Step 4 rather than assuming.
