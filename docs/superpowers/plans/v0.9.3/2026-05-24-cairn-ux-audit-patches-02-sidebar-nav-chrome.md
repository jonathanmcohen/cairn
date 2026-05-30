# P02 — Sidebar & Navigation Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix sidebar rendering bugs (shortcode leak, icon/title overlap), rebalance lower-nav hierarchy, add a Settings entry + ⌘K hint, link the version footer, and improve the workspace switcher affordance + hit target.

**Architecture:** Mostly markup/CSS + small client tweaks in `src/components/sidebar*` and `src/app/(app)/layout.tsx`. The icon bugs are logic: ensure every render routes the stored icon string through `parseIcon` (`src/lib/pages/icon-format.ts`) and renders a single side-by-side row.

**Tech Stack:** React 19 (RSC + client), Tailwind v4, lucide-react, next-themes.

**Covers:** GH #10 (a1 shortcode), #11 (a2 overlap), #12 (a3 switcher), #13 (a4 theme placement), #14 (a5 hierarchy), #15 (a6 version link), #41 (a32 chevron target), #42 (a33 resize handle), #43 (a34 ⌘K hint), #44 (a35 sign-out separation), #45 (a36 Settings entry).

---

### Task 1: Strip `emoji::` shortcode + fix icon/title overlap (#10, #11)

**Files:**
- Modify: `src/components/sidebar/virtualized-page-tree.tsx` (row render ~L193-209)
- Reference: `src/lib/pages/icon-format.ts` (`parseIcon`), `src/components/page-icon-render.tsx`
- Test: `tests/components/sidebar/page-row-icon.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import type { FlatPageNode } from '@/lib/pages/tree';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return (this as HTMLElement).classList?.contains?.('overflow-y-auto') ? 600 : 0; },
  });
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  }
});
afterEach(cleanup);

describe('page row icon rendering', () => {
  it('does NOT leak the emoji:: shortcode prefix into the DOM', () => {
    const pages: FlatPageNode[] = [
      { id: 'p1', parentId: null, title: 'Test', icon: 'emoji::💡', depth: 0 },
    ];
    const { container } = render(<VirtualizedPageTree initial={pages} />);
    expect(container.textContent).toContain('Test');
    expect(container.textContent).not.toContain('emoji::');
    expect(container.textContent).toContain('💡');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/page-row-icon.test.tsx`
Expected: FAIL — `emoji::` present (raw icon rendered) or 💡 absent.

- [ ] **Step 3: Route the icon through `parseIcon` and render a single row**

In `virtualized-page-tree.tsx`, where the row renders `node.icon ?? '📄'` (~L205), replace the raw render with the parsed glyph/image. Add `import { parseIcon } from '@/lib/pages/icon-format';` and render:

```tsx
{/* icon cell — fixed width, never overlaps the title */}
<span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">
  {renderNodeIcon(node.icon)}
</span>
<span className="min-w-0 flex-1 truncate">{node.title}</span>
```

Add a small helper near the top of the file:

```tsx
function renderNodeIcon(stored: string | null): React.ReactNode {
  const parsed = parseIcon(stored);
  if (parsed.kind === 'emoji') return parsed.value;
  if (parsed.kind === 'file') return <span aria-hidden>🖼️</span>; // image icons resolve server-side elsewhere
  return '📄';
}
```

Confirm the row container is `flex items-center gap-2` (not stacked/absolute). If the current row uses absolute positioning or a grid that stacks, change to `flex items-center gap-2` so the icon and title sit side-by-side. Verify `parseIcon`’s actual return shape first (read `icon-format.ts`) and match the `kind`/`value` field names exactly.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/page-row-icon.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/virtualized-page-tree.tsx tests/components/sidebar/page-row-icon.test.tsx
git commit -m "fix(sidebar): parse icon shortcode + single-row icon/title layout — Closes #10 Closes #11"
```

---

### Task 2: Add Settings entry + rebalance lower-nav hierarchy + sign-out separation (#45, #14, #44)

**Files:**
- Modify: `src/components/sidebar-content.tsx` (footer nav ~L64-93)
- Test: `tests/components/sidebar-content-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarContent } from '@/components/sidebar-content';

afterEach(cleanup);

describe('sidebar lower nav', () => {
  it('includes a Settings link to /settings', async () => {
    // SidebarContent is async (server component); render its resolved element.
    const el = await SidebarContent({ /* pass the minimal props it requires */ } as never);
    render(el as React.ReactElement);
    const settings = screen.getByRole('link', { name: /settings/i });
    expect(settings.getAttribute('href')).toBe('/settings');
  });
});
```

Note: `SidebarContent` is a server component that takes props (workspace, pages, etc.). The implementer must read its signature and construct minimal valid props, or extract the footer into a small pure `SidebarFooterNav` client component and test that instead (preferred — cleaner unit). If extracting, the test imports `SidebarFooterNav`.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-content-nav.test.tsx`
Expected: FAIL — no Settings link.

- [ ] **Step 3: Add the Settings link + rebalance**

In the footer nav (`sidebar-content.tsx` ~L64-93): add a Settings link (lucide `Settings` icon, href `/settings`) alongside My tasks / Templates / Trash. Apply a consistent nav-item class so these read as first-class (e.g. `flex items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent`) — match the weight/contrast used by the "PAGES" section items so hierarchy is no longer inverted. Wrap Sign out in a divider group:

```tsx
<div className="mt-2 border-t border-border pt-2">
  {/* existing sign-out form */}
</div>
```

- [ ] **Step 4: Run the test, confirm it passes; visual check**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-content-nav.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS. In `pnpm dev`, confirm Settings reachable from the sidebar, nav items read as primary, Sign out is visually separated.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar-content.tsx tests/components/sidebar-content-nav.test.tsx
git commit -m "feat(sidebar): add Settings nav entry, rebalance lower nav, separate sign out — Closes #45 Closes #14 Closes #44"
```

---

### Task 3: Link the version footer to the release notes (#15)

**Files:**
- Modify: `src/components/sidebar-content.tsx` (version footer ~L92), uses `appVersion()` from `src/lib/version.ts`

- [ ] **Step 1: Replace the dead text with a link**

```tsx
<div className="mt-2 text-center text-xs text-muted-foreground">
  <a
    href={`https://github.com/jonathanmcohen/cairn/releases/tag/v${appVersion()}`}
    target="_blank"
    rel="noreferrer"
    className="hover:text-foreground hover:underline"
  >
    v{appVersion()}
  </a>
</div>
```

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. Confirm link points at the current tag in `pnpm dev`.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar-content.tsx
git commit -m "feat(sidebar): link version footer to GitHub release notes — Closes #15"
```

---

### Task 4: Workspace switcher affordance + hit target (#12, #41)

**Files:**
- Modify: `src/components/workspace-switcher.tsx` (`<summary>` + ChevronsUpDown ~L60)

- [ ] **Step 1: Make the whole summary row a comfortable target with a clear caret**

Change the `<summary>` to a full-width, `min-h-9`, padded clickable row: workspace name on the left, a single `ChevronDown` (not tiny ChevronsUpDown) on the right, with `cursor-pointer select-none rounded px-2 py-1.5 hover:bg-accent`. Ensure the clickable area is ≥24px tall (target ≥44px where feasible). Add `aria-label="Switch workspace"`.

```tsx
<summary className="flex min-h-9 cursor-pointer select-none list-none items-center justify-between gap-2 rounded px-2 py-1.5 text-sm font-medium hover:bg-accent" aria-label="Switch workspace">
  <span className="truncate">{currentWorkspaceName}</span>
  <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
</summary>
```

(Use the real variable for the current workspace name from the file; add `list-none` + the `::-webkit-details-marker{display:none}` rule if the default disclosure triangle shows — check existing styling.)

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. In `pnpm dev`, confirm the row reads as a switcher and the whole row is clickable.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace-switcher.tsx
git commit -m "fix(sidebar): clearer workspace switcher affordance + larger hit target — Closes #12 Closes #41"
```

---

### Task 5: ⌘K command-palette hint (#43)

**Files:**
- Modify: `src/components/sidebar-content.tsx` (add a search affordance near the top of the nav body) OR `src/app/(app)/layout.tsx` top bar
- Reference: `src/components/search-palette.tsx` (the palette + Cmd+K listener)

- [ ] **Step 1: Add a visible search button with the ⌘K hint that opens the palette**

Add a small client component `src/components/search-hint-button.tsx`:

```tsx
'use client';
import { Search } from 'lucide-react';

export function SearchHintButton() {
  function open() {
    // Reuse the palette's existing keyboard path: dispatch the same shortcut it listens for.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  }
  return (
    <button
      type="button"
      onClick={open}
      className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
    </button>
  );
}
```

Verify in `search-palette.tsx` that its listener matches `metaKey && key==='k'`; if it also requires `e.preventDefault` on a real event only, instead expose an explicit open mechanism (e.g. a shared context/store or a custom `window` event the palette subscribes to) and call that — pick whichever the palette already supports. Mount `<SearchHintButton />` at the top of the sidebar nav body in `sidebar-content.tsx`.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. In `pnpm dev`, click the hint → palette opens; ⌘K still works.

- [ ] **Step 3: Commit**

```bash
git add src/components/search-hint-button.tsx src/components/sidebar-content.tsx
git commit -m "feat(sidebar): visible search affordance with ⌘K hint — Closes #43"
```

---

### Task 6: Theme-toggle placement note + Settings appearance link (#13)

**Files:**
- Modify: `src/components/sidebar-content.tsx` (keep toggle but relocate within header) and/or settings
- Decision: keep a quick toggle in chrome, but make Settings the canonical home.

- [ ] **Step 1: Decide + implement the minimal change**

Per the audit, the toggle "lives in the workspace header instead of settings — odd placement." Lowest-risk resolution: keep the quick toggle but move it out of the workspace-switcher header row into the footer account group (next to Sign out / Settings) where account-level controls live, so it no longer competes with the workspace switcher. (A full appearance settings page is out of scope; the existing ThemePicker at `user_theme_prefs`/settings remains the deep control.)

Move `<ThemeToggle />` from the header (`sidebar-content.tsx` ~L46) into the footer account group created in Task 2 (next to Settings/Sign out).

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. Confirm toggle still flips theme.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar-content.tsx
git commit -m "fix(sidebar): relocate theme toggle to account group — Closes #13"
```

---

### Task 7: Sidebar resize handle / justify width (#42) — lowest priority

**Files:**
- Modify: `src/components/sidebar.tsx` (fixed `w-64`)

- [ ] **Step 1: Choose scope**

A full drag-to-resize with persisted width is non-trivial. For this patch batch, the pragmatic resolution is to keep a fixed width but make it intentional: confirm `w-64` is reasonable and add a subtle right border so the boundary is visible (`border-r border-border`). Document in the issue that full resize is deferred.

```tsx
// sidebar.tsx <aside> className: ensure it includes
"w-64 shrink-0 border-r border-border"
```

- [ ] **Step 2: Comment the issue with the deferral**

```bash
gh issue comment 42 --body "Resolved minimally: kept fixed w-64 with a visible right border so the boundary reads intentionally. Full drag-to-resize with persisted width deferred as a standalone enhancement (needs a width store + persistence)."
```

- [ ] **Step 3: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`

```bash
git add src/components/sidebar.tsx
git commit -m "polish(sidebar): visible boundary border; defer drag-resize — Closes #42"
```

---

## Self-Review

- Covers #10,#11,#12,#13,#14,#15,#41,#42,#43,#44,#45. ✓
- Icon bug is the only true logic fix (TDD'd); rest are markup/CSS with lint/type/visual verification. ✓
- #42 scoped down explicitly with an issue comment rather than silently dropping the harder part. ✓
- Inline open questions (parseIcon shape, palette open mechanism, SidebarContent props) flagged for the implementer to resolve by reading the file — not assumed. ✓
