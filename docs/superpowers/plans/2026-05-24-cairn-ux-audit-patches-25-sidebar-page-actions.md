# P25 — Sidebar Page-Row Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. One implementer subagent per task, fresh context, full task text pasted in; main thread reviews + commits between tasks.

**Goal:** Give every sidebar page row the quick actions it's missing today. A page row in `src/components/sidebar/virtualized-page-tree.tsx` is a bare `<Link>` — hovering reveals nothing (#103), right-click falls through to the browser's native menu (#102), and the "Search…" affordance's placeholder implies page search but actually opens the global ⌘K palette (#97). This plan adds a hover-revealed `…` actions menu + a `+` add-child button to each row, a keyboard-accessible right-click context menu carrying the same action set, and resolves the #97 affordance ambiguity. These are shared-chrome surfaces, so the WCAG AA + ≥44px touch-target gate is **strict**: every new interactive control clears a 44px hit area (`min-h-11` / `min-w-11` or an explicit ≥44px zone) and every new visible string is routed through i18n.

**Architecture — reuse, do not duplicate.** The row action set (Rename / Move to trash / Duplicate / Copy link / Move to) is the **same action set** the page `…` menu gains in **P19 (`2026-05-24-cairn-ux-audit-patches-19-menus-nav-chrome.md`, #76)**. That plan establishes the canonical backend wiring; this plan **reuses it** rather than re-deriving it. Backend status, carried forward verbatim from P19's Architecture section and re-verified against the current tree:

| Row action | Backend | Status |
|---|---|---|
| Rename | `PATCH /api/pages/[pageId]` `{ title }` → `updatePage` (`src/lib/pages/update.ts`) | **EXISTS** (verify: route `src/app/api/pages/[pageId]/route.ts` `PATCH`, `PatchInput.title`) |
| Move to trash | `DELETE /api/pages/[pageId]` → `softDeletePage` (`src/lib/pages/delete.ts`) | **EXISTS** (same route, `DELETE`) |
| Move to (reparent) | `POST /api/pages/[pageId]/move` `{ newParentId }` → `movePage` (`src/lib/pages/move.ts`) | **EXISTS** |
| Copy link | `navigator.clipboard.writeText(`${origin}/pages/${pageId}`)` | **client-only**, no backend |
| Duplicate page | `POST /api/pages/[pageId]/duplicate` → `duplicateOwnedPage` (`src/lib/pages/duplicate-owned.ts`) | **NEW — built by P19 Task 4.** This plan does NOT rebuild it. |
| Add child page (`+`, #103-specific) | `POST /api/pages` `{ parentId, spaceId }` → `createPage` (`src/lib/pages/create.ts`), returns `{ id }` | **EXISTS** (route `src/app/api/pages/route.ts`; `CreateInput` already accepts `parentId` + `spaceId`) |

**Backend-gap summary (the only thing this plan needs from elsewhere):**
- **No new backend is required by this plan.** Rename, Trash, Move-to, Add-child, and Copy-link all reuse routes that exist **today**. Duplicate reuses the `POST /api/pages/[pageId]/duplicate` endpoint **introduced by P19 Task 4** — so P19 Task 4 is a hard prerequisite for the Duplicate row action only. If P19 has not landed when this plan runs, ship the Duplicate item disabled/omitted and flag it, or land P19 Task 4 first. All other actions are independent of P19.
- Backend gaps found while writing this plan: **none new.** "Add child page" and "Rename" both already have endpoints (`createPage` with `parentId`; `updatePage` with `title`) — they were simply never surfaced from the sidebar. No migration, no new route.

**Shared logic.** Tasks 1–3 share the exact same action list and handlers. To avoid drift between the hover `…` menu and the right-click context menu, extract the action set + handlers into a single `usePageRowActions(node)` hook (Task 1) consumed by both surfaces. Both menus render from the same `PageRowAction[]` descriptor.

**Primitives.** Use the already-installed unified `radix-ui` package (`^1.4.3`, verified to export both `DropdownMenu` and `ContextMenu`). The hover `…` menu uses `DropdownMenu` (Esc + outside-click dismiss + focus restore for free, matching P19 Task 3's switcher rewrite). The right-click menu uses `ContextMenu` (radix gives keyboard access: the row is focusable and the menu opens on the `ContextMenu` key / Shift+F10, arrow-navigable, Esc to close). Reusing radix is the same decision P19 made for the page `…` menu chrome.

**i18n:** flat-key JSON in `messages/{en,es,ar}.json`; client components read via `const t = useT()` from `@/lib/i18n/provider` (`t('key')`, `t('key', { count })`). The tree component currently uses **no** i18n — every new string in this plan is a new key added to **all three** locale files (en authoritative; es/ar may carry the English value as a placeholder when no translation is supplied — match the existing untranslated-key convention). Existing key style is dotted-flat, e.g. `locale.label`, `pageMenu.copyLink`. **Reuse P19's `pageMenu.*` keys where the label is identical** (`pageMenu.copyLink`, `pageMenu.linkCopied`, `pageMenu.duplicate`, `pageMenu.moveTo`, `pageMenu.moveToTrash`, `pageMenu.confirmTrash`, `pageMenu.moveToTopLevel`) so the sidebar and the `…` menu read the same; add new `pageRow.*` keys only for the genuinely new strings (rename, add-child, the row trigger aria-labels).

**Tech Stack:** React 19, `radix-ui` 1.4.3, Tailwind v4, `lucide-react`, `cn()` from `src/lib/utils.ts`, `@tanstack/react-virtual` (already the tree's virtualizer), Vitest 4 (jsdom for component tests), `useRouter().refresh()` from `next/navigation` to re-fetch the server-rendered tree after a mutation.

**Covers (GitHub):** #103 (hover quick actions + add-child), #102 (right-click context menu), #97 (Search… affordance ambiguity).

---

### #97 DECISION (resolve before Task 4)

**Context.** `src/components/search-hint-button.tsx` (added v0.9.3 #43) renders a full-width button labelled `Search…` with a `⌘K` kbd hint. Clicking it dispatches a synthetic `⌘K` keydown (`new KeyboardEvent('keydown', { key: 'k', metaKey: true })`) which the global `SearchPalette` listens for (`src/components/search-palette.tsx` L105: `(e.metaKey || e.ctrlKey) && e.key === 'k'`) and opens the **command palette** (cmdk — search + navigation + commands + recents). The audit flagged that `Search…` + a magnifying glass reads as a *page-search box*, but it actually opens the broader palette.

**Decision: RELABEL to clearly open the palette; keep ⌘K. Do NOT build a separate scoped page-search.** The palette already *is* the page-search surface (it queries `/api/.../search` and lists page results — see `SearchResult[]` in `search-palette.tsx`), plus commands and recents. Splitting page-search out into a second affordance would (a) duplicate the search UI, (b) orphan the palette's command/recents surface from its most discoverable entry point, and (c) add a backend/UX surface the audit didn't ask for. The fix is purely a labelling/affordance change: make the button self-evidently a palette opener. This is the lowest-risk, single-source-of-truth choice and is consistent with how the palette is wired everywhere else (⌘K).

**Implementation (Task 4):** relabel `Search…` → an i18n'd label that names the palette (e.g. `Search & commands` / `Jump to or search…`), keep the `⌘K` kbd, keep the magnifying-glass icon, keep the synthetic-⌘K open mechanism (single source of truth — do not add a second open path). Add an accessible name via `aria-label` and `aria-keyshortcuts="Meta+K"`. No backend, no palette change.

---

### Task 1: Extract a shared `usePageRowActions` hook + `PageRowAction` descriptor

**Files:**
- Create: `src/components/sidebar/use-page-row-actions.tsx`
- Test: `tests/components/sidebar/use-page-row-actions.test.tsx` (create)

This hook is the single source of truth for the row action set, consumed by both the hover `…` `DropdownMenu` (Task 2) and the right-click `ContextMenu` (Task 3). It returns an ordered `PageRowAction[]` (each: `id`, `label` via `t()`, `icon` lucide component, `run()`), plus any transient UI state (e.g. `linkCopied`). Keep it framework-pure (a hook returning descriptors + handlers) so both menus render identically and the handlers are tested once.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePageRowActions } from '@/components/sidebar/use-page-row-actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// i18n provider: stub useT to echo the key so labels are assertable without a provider.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);

const node = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Doc',
  spaceId: null,
  depth: 0,
  icon: null,
} as unknown as import('@/lib/pages/tree').FlatPageNode;

describe('usePageRowActions', () => {
  it('exposes the canonical action set in order', () => {
    const { result } = renderHook(() => usePageRowActions(node));
    const ids = result.current.actions.map((a) => a.id);
    expect(ids).toEqual(['rename', 'addChild', 'duplicate', 'copyLink', 'moveTo', 'trash']);
    for (const a of result.current.actions) {
      expect(typeof a.label).toBe('string');
      expect(a.icon).toBeTruthy();
      expect(typeof a.run).toBe('function');
    }
  });

  it('copyLink writes the internal page URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => usePageRowActions(node));
    const copy = result.current.actions.find((a) => a.id === 'copyLink');
    await act(async () => { await copy?.run(); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/pages/${node.id}`));
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/use-page-row-actions.test.tsx`
Expected: FAIL — module `@/components/sidebar/use-page-row-actions` not found.

- [ ] **Step 3: Implement the hook**

```tsx
'use client';

import { Copy, CopyPlus, FilePlus2, FolderInput, Pencil, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { FlatPageNode } from '@/lib/pages/tree';

export type PageRowAction = {
  id: 'rename' | 'addChild' | 'duplicate' | 'copyLink' | 'moveTo' | 'trash';
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  run: () => void | Promise<void>;
};

export type PageRowActionsApi = {
  actions: PageRowAction[];
  linkCopied: boolean;
  /** Set by the consuming menu to begin inline rename (Task 2 wires this). */
  startRename: () => void;
  renaming: boolean;
  submitRename: (next: string) => Promise<void>;
  cancelRename: () => void;
};

export function usePageRowActions(node: FlatPageNode): PageRowActionsApi {
  const t = useT();
  const router = useRouter();
  const [linkCopied, setLinkCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/pages/${node.id}`;
    void navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }, [node.id]);

  const addChild = useCallback(async () => {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: node.id, spaceId: node.spaceId ?? undefined }),
    });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    router.push(`/pages/${id}` as Route);
  }, [node.id, node.spaceId, router]);

  const duplicate = useCallback(async () => {
    // Reuses the endpoint introduced by P19 Task 4 (duplicateOwnedPage).
    const res = await fetch(`/api/pages/${node.id}/duplicate`, { method: 'POST' });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    router.push(`/pages/${id}` as Route);
  }, [node.id, router]);

  const moveToTrash = useCallback(async () => {
    if (!window.confirm(t('pageMenu.confirmTrash'))) return;
    const res = await fetch(`/api/pages/${node.id}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
  }, [node.id, router, t]);

  const submitRename = useCallback(
    async (next: string) => {
      const title = next.trim();
      setRenaming(false);
      if (!title || title === node.title) return;
      const res = await fetch(`/api/pages/${node.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) router.refresh();
    },
    [node.id, node.title, router],
  );

  const actions: PageRowAction[] = [
    { id: 'rename', label: t('pageRow.rename'), icon: Pencil, run: () => setRenaming(true) },
    { id: 'addChild', label: t('pageRow.addChild'), icon: FilePlus2, run: addChild },
    { id: 'duplicate', label: t('pageMenu.duplicate'), icon: CopyPlus, run: duplicate },
    {
      id: 'copyLink',
      label: linkCopied ? t('pageMenu.linkCopied') : t('pageMenu.copyLink'),
      icon: Copy,
      run: copyLink,
    },
    { id: 'moveTo', label: t('pageMenu.moveTo'), icon: FolderInput, run: () => { /* Task 3 picker */ } },
    { id: 'trash', label: t('pageMenu.moveToTrash'), icon: Trash2, destructive: true, run: moveToTrash },
  ];

  return {
    actions,
    linkCopied,
    startRename: () => setRenaming(true),
    renaming,
    submitRename,
    cancelRename: () => setRenaming(false),
  };
}
```

Notes:
- The action **order** is fixed by the test: `rename, addChild, duplicate, copyLink, moveTo, trash`. Both menus render in this order; `trash` is rendered last with a leading separator + `destructive` styling.
- `moveTo`'s `run` is a stub placeholder here — the picker UX is wired in Task 3 (reuses `POST /api/pages/[pageId]/move`). See the Task-3 "Move to picker" sub-step + off-ramp; this mirrors P19 Task 5's "stop and flag if >~30 lines" treatment of the same picker.
- After Trash/Move/Add-child/Rename succeed, prefer `router.refresh()` (re-fetches the server-rendered `flattenedPageTree`) over a full reload — the tree is server-rendered into `VirtualizedPageTree`'s `initial` prop. For Add-child/Duplicate we additionally `router.push` to the new page.
- i18n new keys this hook introduces: `pageRow.rename`, `pageRow.addChild`. All `pageMenu.*` keys are **reused from P19** (add them here only if P19 hasn't landed yet — in that case create them and P19 will dedupe).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/use-page-row-actions.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean. If `pageMenu.*` keys don't exist yet (P19 not landed), add them to all three locale files so `useT` resolves; otherwise reuse.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/use-page-row-actions.tsx tests/components/sidebar/use-page-row-actions.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "feat(sidebar): shared usePageRowActions hook for row action set — refs #102 #103"
```

---

### Task 2: Hover-revealed `…` menu + `+` add-child button + inline rename on each page row (#103)

**Files:**
- Modify: `src/components/sidebar/virtualized-page-tree.tsx`
- Create: `src/components/sidebar/page-row-actions-menu.tsx` (the `DropdownMenu` + `+` button cluster; keeps the tree file readable)
- Test: `tests/components/sidebar/page-row-actions-menu.test.tsx` (create)

Today a page row is a single `<Link>` with no trailing controls (`virtualized-page-tree.tsx` L205–224). Add a trailing action cluster that is **visually revealed on hover/focus** but **always present in the DOM** (so it's keyboard- and SR-reachable — `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`, never `hidden`, which would drop it from the a11y tree). The cluster holds a `+` add-child button and a `…` `DropdownMenu` trigger driven by `usePageRowActions`. Inline rename swaps the row's title `<span>` for a text `<input>` while `renaming` is true.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRowActionsMenu } from '@/components/sidebar/page-row-actions-menu';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);

const node = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Doc',
  spaceId: null,
  depth: 0,
  icon: null,
} as unknown as import('@/lib/pages/tree').FlatPageNode;

describe('<PageRowActionsMenu>', () => {
  it('renders an add-child button and a menu trigger, both keyboard-reachable (in DOM, not hidden)', () => {
    render(<PageRowActionsMenu node={node} />);
    const add = screen.getByRole('button', { name: /add (a )?(sub)?page|add child/i });
    const more = screen.getByRole('button', { name: /(page )?actions|more/i });
    expect(add).toBeTruthy();
    expect(more).toBeTruthy();
    // Touch-target gate: both clear ≥44px.
    expect(add.className).toMatch(/min-h-11|h-11/);
    expect(more.className).toMatch(/min-h-11|h-11/);
  });

  it('opens the actions menu and shows Rename + Move to trash', async () => {
    render(<PageRowActionsMenu node={node} />);
    fireEvent.click(screen.getByRole('button', { name: /(page )?actions|more/i }));
    expect(await screen.findByRole('menuitem', { name: /rename/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /trash/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/page-row-actions-menu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PageRowActionsMenu`**

Render the `+` button and the `…` `DropdownMenu` from radix, both driven by `usePageRowActions(node)`. Sketch:

```tsx
'use client';

import { MoreHorizontal, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import type { FlatPageNode } from '@/lib/pages/tree';
import { usePageRowActions } from './use-page-row-actions';

const ICON_BTN =
  'flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring outline-hidden';
const ITEM_CLASS =
  'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground';

export function PageRowActionsMenu({ node }: { node: FlatPageNode }) {
  const t = useT();
  const { actions } = usePageRowActions(node);
  const addChild = actions.find((a) => a.id === 'addChild');
  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-label={t('pageRow.addChild')}
        className={ICON_BTN}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void addChild?.run(); }}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t('pageRow.actions')}
          className={ICON_BTN}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {actions.map((a, i) => (
              <div key={a.id}>
                {a.id === 'trash' && <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-muted" />}
                <DropdownMenu.Item
                  onSelect={() => void a.run()}
                  className={cn(ITEM_CLASS, a.destructive && 'text-destructive focus:text-destructive')}
                >
                  <a.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {a.label}
                </DropdownMenu.Item>
              </div>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
```

Notes:
- radix `DropdownMenu.Item` `onSelect` fires on click + Enter/Space, closes the menu, and restores focus to the trigger — Esc + outside-click dismiss come free (same rationale as P19 Task 3).
- Stop click propagation on the trigger/`+` so the row's `<Link>` navigation doesn't fire when the user clicks an action.
- New i18n keys: `pageRow.actions` (the `…` trigger aria-label, e.g. "Page actions"), `pageRow.addChild` (already added in Task 1, reuse). All three locale files.
- The ≥44px gate: both icon buttons are `min-h-11 min-w-11`; every `DropdownMenu.Item` is `min-h-11`. The visible icon is 16px but the hit zone is 44px (centered via flex) — do not shrink it.

- [ ] **Step 4: Wire the cluster + inline rename into the tree's page row**

In `virtualized-page-tree.tsx`, the page-row `<li>` (L205–224): add `group` to the `<li>` (or to a row wrapper) so `group-hover`/`group-focus-within` can reveal the cluster, and render `<PageRowActionsMenu node={node} />` as a trailing child of the row, wrapped in a reveal wrapper:

```tsx
<span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
  <PageRowActionsMenu node={node} />
</span>
```

The cluster sits **after** the title span; the `<Link>` keeps `flex-1 min-w-0 truncate` so the title still ellipsizes and the cluster stays right-aligned. Because the cluster lives inside the same row but must not be inside the `<Link>` (nested interactive elements are invalid), restructure the row so the `<Link>` and the cluster are **siblings** under the row `<li>` (e.g. `<li class="group flex items-center …"> <Link class="flex-1 …">…</Link> <reveal-wrapper/> </li>`), preserving the existing `paddingLeft` depth indent on the row container (move the inline `paddingLeft` from the `<Link>` to the `<li>` or a wrapper so the whole row indents).

**Inline rename:** when `usePageRowActions(node).renaming` is true, replace the title `<span>` with a controlled `<input>` (autofocus, `defaultValue={node.title}`, submit on Enter/blur → `submitRename`, cancel on Esc → `cancelRename`). The simplest, least-disruptive shape is to keep the rename state inside `PageRowActionsMenu` and render the input there OR lift `usePageRowActions` to the row and pass the api down — **decide in-file**: lifting the hook to the row is cleaner because the title `<span>`/`<input>` swap lives in the row, not the menu. If lifting, the row calls `usePageRowActions(node)` once and passes `{ actions, renaming, submitRename, cancelRename }` into `PageRowActionsMenu` as props (refactor `PageRowActionsMenu` to accept the api instead of calling the hook itself). Pick one and keep the hook called exactly once per row.

Keep the row height at `ROW_HEIGHT_PX` (32) for the virtualizer's `estimateSize`; the 44px action buttons may visually exceed the row but the virtualizer measures actual size — verify scrolling still works (the buttons can overflow the 32px row vertically centered; if that breaks measurement, give the row `min-h` and let the virtualizer re-measure, or constrain the buttons to a 28–32px visual box with a 44px *pointer* hit area via negative margin/padding — prefer the latter to keep row rhythm).

- [ ] **Step 5: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/page-row-actions-menu.test.tsx && pnpm vitest run tests/components/sidebar/ && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; existing page-tree tests still pass (the row restructure must not break virtualization/space-grouping assertions — re-run the whole `tests/components/sidebar/` dir). Build is run because `virtualized-page-tree.tsx` is a heavy client component.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/virtualized-page-tree.tsx src/components/sidebar/page-row-actions-menu.tsx tests/components/sidebar/page-row-actions-menu.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "feat(sidebar): hover quick-actions menu + add-child + inline rename on page rows — Closes #103"
```

---

### Task 3: Right-click context menu on page rows with the same action set (#102)

**Files:**
- Modify: `src/components/sidebar/virtualized-page-tree.tsx`
- Create: `src/components/sidebar/page-row-context-menu.tsx`
- Test: `tests/components/sidebar/page-row-context-menu.test.tsx` (create)

Today right-clicking a page row shows the **browser's** native context menu. Wrap each page row in radix `ContextMenu` so right-click (and the keyboard ContextMenu key / Shift+F10) opens an app menu carrying the **same `usePageRowActions` set** as Task 2 — single source of truth, no divergence.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRowContextMenu } from '@/components/sidebar/page-row-context-menu';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);

const node = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Doc',
  spaceId: null,
  depth: 0,
  icon: null,
} as unknown as import('@/lib/pages/tree').FlatPageNode;

describe('<PageRowContextMenu>', () => {
  it('opens an app context menu on right-click with the canonical actions', async () => {
    render(
      <PageRowContextMenu node={node}>
        <div data-testid="row">Doc</div>
      </PageRowContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('row'));
    expect(await screen.findByRole('menuitem', { name: /rename/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /copy link/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /move to/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /trash/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/page-row-context-menu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PageRowContextMenu`**

```tsx
'use client';

import { ContextMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import type { FlatPageNode } from '@/lib/pages/tree';
import { usePageRowActions } from './use-page-row-actions';

const ITEM_CLASS =
  'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground';

export function PageRowContextMenu({ node, children }: { node: FlatPageNode; children: ReactNode }) {
  const { actions } = usePageRowActions(node);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {actions.map((a) => (
            <div key={a.id}>
              {a.id === 'trash' && <ContextMenu.Separator className="-mx-1 my-1 h-px bg-muted" />}
              <ContextMenu.Item
                onSelect={() => void a.run()}
                className={cn(ITEM_CLASS, a.destructive && 'text-destructive focus:text-destructive')}
              >
                <a.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                {a.label}
              </ContextMenu.Item>
            </div>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
```

Notes:
- radix `ContextMenu` is keyboard-accessible: the trigger is focusable; the menu opens on the ContextMenu key / Shift+F10 when the trigger has focus, items are arrow-navigable, Esc closes, focus restores — this satisfies the "keyboard-accessible context menu" constraint without extra wiring.
- **Shared logic:** this menu and Task 2's `…` menu both render `usePageRowActions(node).actions` in the same order with the same item markup — they are intentionally near-identical. If during implementation the two `actions.map(...)` bodies are byte-identical except for the radix namespace, extract a tiny `PageActionItems` render-helper that takes the `Item`/`Separator` components as props and the `actions` array, and have both menus call it. Only do this if it genuinely dedupes (>~10 lines); otherwise the duplication is acceptable since the *action set itself* already lives in the hook.

- [ ] **Step 4: Wire into the tree row + finish the "Move to" picker**

In `virtualized-page-tree.tsx`, wrap the page row's content in `<PageRowContextMenu node={node}>…</PageRowContextMenu>` (the `Trigger asChild` wraps the row's `<Link>`/row container — verify nesting stays valid; `asChild` forwards props onto the child, so wrap the row container element, not a raw fragment).

**Move to picker (shared with Task 2's `moveTo` stub):** both menus' `moveTo` action needs a parent-picker, then `POST /api/pages/[pageId]/move { newParentId }` (must allow `newParentId: null` = "Move to top level"). This is the **same picker problem P19 Task 5 flagged** for the page `…` menu. **Reuse the resolution P19 lands** — if P19 shipped a self-contained move picker, import and reuse it here; if P19 deferred the picker as the `#76 Move-to picker` follow-up, **do the same**: ship Rename/Add-child/Duplicate/Copy-link/Trash fully wired, leave `moveTo` as a flagged follow-up (`#102/#103 Move-to picker`, shared with `#76`), and do NOT build a second bespoke picker here. The move *endpoint* is trivial; the *picker UX* is the only unknown and must not be duplicated across P19 and P25. Note the decision in the commit body.

- [ ] **Step 5: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/page-row-context-menu.test.tsx && pnpm vitest run tests/components/sidebar/ && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; whole sidebar dir still green; clean build.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/virtualized-page-tree.tsx src/components/sidebar/page-row-context-menu.tsx tests/components/sidebar/page-row-context-menu.test.tsx
git commit -m "feat(sidebar): radix context menu on page rows (keyboard-accessible) — Closes #102"
```

---

### Task 4: Relabel the "Search…" affordance to clearly open the command palette (#97)

> **Decision (see #97 DECISION above):** relabel to name the palette, keep ⌘K, keep the synthetic-⌘K open mechanism. No scoped page-search, no backend, no palette change.

**Files:**
- Modify: `src/components/search-hint-button.tsx`
- Test: `tests/components/search-hint-button.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchHintButton } from '@/components/search-hint-button';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);

describe('<SearchHintButton>', () => {
  it('names the command palette (not bare "Search…") and advertises the ⌘K shortcut', () => {
    render(<SearchHintButton />);
    const btn = screen.getByRole('button');
    // i18n key (stubbed to echo) names the palette, not a bare search box.
    expect(btn.textContent ?? '').toMatch(/searchHint\.label|palette|command/i);
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
    expect(btn.className).toMatch(/min-h-11/);
  });

  it('dispatches the ⌘K shortcut to open the palette on click', () => {
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    render(<SearchHintButton />);
    fireEvent.click(screen.getByRole('button'));
    window.removeEventListener('keydown', onKey);
    const ev = onKey.mock.calls.at(-1)?.[0] as KeyboardEvent | undefined;
    expect(ev?.key).toBe('k');
    expect(ev?.metaKey).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-hint-button.test.tsx`
Expected: FAIL — the button is text-only `Search…`, has no `aria-keyshortcuts`, no `useT`, and `min-h-11` is present today (verify) but the label/aria assertions fail.

- [ ] **Step 3: Relabel + i18n + aria**

Edit `src/components/search-hint-button.tsx`: add `const t = useT();` (import `useT` from `@/lib/i18n/provider`). Replace the literal `Search…` span with `{t('searchHint.label')}`, add `aria-label={t('searchHint.aria')}` and `aria-keyshortcuts="Meta+K"` to the `<button>`. Keep the magnifying-glass icon, keep the `⌘K` `<kbd>`, keep the existing `open()` synthetic-keydown mechanism unchanged (single source of truth — do NOT add a second open path). Keep the existing `min-h-11` class (verify it's still there). New i18n keys (all three locale files): `searchHint.label` (e.g. "Search & commands" or "Search or jump to…" — choose the clearer; en authoritative) and `searchHint.aria` (e.g. "Open command palette").

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-hint-button.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/search-hint-button.tsx tests/components/search-hint-button.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(sidebar): relabel search affordance to clearly open the command palette (⌘K) — Closes #97"
```

---

## Self-Review

- **Coverage:** #103 (Task 1 hook + Task 2 hover `…` menu + `+` add-child + inline rename), #102 (Task 1 hook + Task 3 right-click context menu), #97 (Task 4 relabel). All three issues mapped. ✓
- **#97 decision stated + implemented consistently:** RELABEL the affordance to name the palette, keep ⌘K + the single synthetic-keydown open path; no scoped page-search built. Rationale: the palette already is page-search + commands + recents; a second affordance would duplicate UI and orphan the palette. ✓
- **P18/P19 reuse (the shared dependency):** the row action set is the same set P19 (#76) adds to the page `…` menu. This plan **reuses** P19's backend wiring — Trash (`DELETE /api/pages/[pageId]`), Move-to (`POST .../move`), Copy-link (client-only) all exist today; **Duplicate reuses P19 Task 4's new `POST /api/pages/[pageId]/duplicate` (`duplicateOwnedPage`)** and that task is the only hard prerequisite (for the Duplicate item only). The "Move to" picker UX is explicitly **shared** with P19 Task 5's flagged `#76 Move-to picker` follow-up — reuse P19's resolution, do not build a second picker. ✓
- **Backend gaps found:** none new. Add-child reuses `POST /api/pages` (`createPage`, already accepts `parentId` + `spaceId`); Rename reuses `PATCH /api/pages/[pageId]` (`updatePage` with `title`). Both endpoints existed but were never surfaced from the sidebar. No migration, no new route required by this plan. ✓
- **Single source of truth:** `usePageRowActions` (Task 1) is the one action list; both the hover `…` `DropdownMenu` and the right-click `ContextMenu` render from it, preventing drift. ✓
- **Strict touch-target gate:** every new control is `min-h-11`/`min-w-11` (icon buttons centered in a 44px hit zone; menu items `min-h-11`). The reveal cluster uses `opacity-0 group-hover/focus-within:opacity-100`, never `hidden`, so it stays keyboard- and SR-reachable. ✓
- **Keyboard-accessible context menu:** radix `ContextMenu` provides ContextMenu-key/Shift+F10 open, arrow nav, Esc, focus restore. radix `DropdownMenu` provides the same for the hover `…` menu. ✓
- **i18n:** every new visible string is a key in `messages/{en,es,ar}.json` via `useT()`; identical labels reuse P19's `pageMenu.*` keys, with new `pageRow.*` + `searchHint.*` keys only for genuinely new strings. ✓
- **Virtualizer caution flagged:** Task 2 Step 4 warns that 44px buttons may exceed the 32px `ROW_HEIGHT_PX` and tells the implementer to keep row rhythm via a 44px *pointer* hit area rather than growing every row, re-running the full sidebar test dir to confirm virtualization/space-grouping still holds. ✓
- **Per-task commit** with `Closes #NN` (Task 1 uses `refs` since it's shared infra; Tasks 2/3/4 carry `Closes`). Lint/typecheck gate every task; `pnpm build` added where the heavy client tree component is touched (Tasks 2/3). ✓
- **No `git push`** — controller/human pushes (CLAUDE.md). ✓
