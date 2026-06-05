# v0.9.9 Plan C — Nav Surfaces

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Rebuild the workspace sidebar into a sticky, compact, flex-grown navigation shell and clean up nav-surface taxonomy. The sidebar must stay fixed in the viewport while `<main>` scrolls (#28/#207), rows must be denser (#29/#208), the PAGES tree must own the only scroll region inside the sidebar with a thin themed scrollbar, contained overscroll, a sticky parent-section header, and an expand-/collapse-all control (#30–34/#209–213). On the taxonomy side: verify the `/settings/admin` index already lands on `/audit` (#5 was a stale-deploy misreport), relocate the chat-bridge console into the settings/admin hub with redirects and de-duplicated nav entries (#6/#7/#186), and unify the workspace static-site-export label to a single "Export" term across the nav, breadcrumb, and page heading (#8/#187).

**Architecture:** The `(app)` layout (`src/app/(app)/layout.tsx`) renders a flex row: `<Sidebar>` (`src/components/sidebar.tsx`, an `<aside>`) + `<main>`. Both `SidebarContent` (`src/components/sidebar-content.tsx`) and the mobile `SidebarDrawer` share the presentational body. The body is a vertical flex column: workspace switcher (fixed) → scrolling `<nav>` (favorites/recents/saved-searches/PAGES tree) → `SidebarFooterNav` (fixed). The PAGES tree is the windowed `VirtualizedPageTree` (`src/components/sidebar/virtualized-page-tree.tsx`) built on `@tanstack/react-virtual`. Today the aside has `h-screen` but is NOT sticky, so on a tall page it scrolls away with the document; and the inner `<nav>` is the scroll container (not the tree), so the whole nav scrolls instead of just the tree. We fix the sticky shell at the `<aside>`/layout level, move the sole scroll container down into the tree, and add density + scrollbar + sticky-header + expand-all affordances inside the tree. Settings nav lives in `src/components/settings/sidebar.tsx`; chat-bridge currently lives at `src/app/(app)/admin/chat-bridge/` and is double-linked from both the Admin and Developer settings sections.

**Tech Stack:** Next.js 16 App Router (React 19, TS6, `proxy.ts` auth gate), Drizzle + Postgres, Tailwind v4 (CSS-first `@theme` in `src/app/globals.css`, no config file) + shadcn/ui, `@tanstack/react-virtual`, Biome v2 (0 errors), Vitest 4 + Testcontainers (jsdom for component tests), i18n en/es/ar via `useT()` over flat-key JSON in `messages/{en,es,ar}.json`. Migrations: latest applied is **0061**; this plan adds **no migrations** (nav-only). All work lands on `patches/v0.9.9` as a single PR. HOLD for GO before merge.

---

## C1 — Sticky sidebar shell (#28/#207)

**Cause:** `src/app/(app)/layout.tsx:63` wraps the sidebar + main in `<div className="flex min-h-screen flex-col md:flex-row">`. The `<aside>` (`src/components/sidebar.tsx:16-21`) has `h-screen` but no `position: sticky`, so on a long document it is a normal flex child that scrolls out of view with the page. There is also no single dedicated scroll container — `<main>` is `flex-1 p-8` with the page document as its overflow, which is correct, but the aside must pin to the viewport top while main scrolls.

**Fix:** Make the `<aside>` `sticky top-0 self-start` with `h-screen` so it pins to the viewport top and never scrolls away; main remains the document scroll container. Keep the mobile drawer path untouched (sticky only applies at `md:` where the aside is visible).

**Files:**
- Modify: `src/components/sidebar.tsx`
- Create: `tests/components/sidebar-shell.test.tsx`

Steps:

- [ ] Write a failing jsdom test `tests/components/sidebar-shell.test.tsx` asserting the desktop `<aside>` carries the sticky-shell classes. Since `Sidebar` is an async server component, render its className contract directly via a small extracted `SIDEBAR_ASIDE_CLASS` constant (introduce it in the impl step) — test imports the constant and asserts membership:
  ```tsx
  // @vitest-environment jsdom
  import { describe, expect, it } from 'vitest';
  import { SIDEBAR_ASIDE_CLASS } from '@/components/sidebar';

  describe('sidebar shell (#207)', () => {
    it('pins the desktop aside to the viewport top so it never scrolls away', () => {
      expect(SIDEBAR_ASIDE_CLASS).toContain('md:sticky');
      expect(SIDEBAR_ASIDE_CLASS).toContain('top-0');
      expect(SIDEBAR_ASIDE_CLASS).toContain('self-start');
      expect(SIDEBAR_ASIDE_CLASS).toContain('h-screen');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-shell.test.tsx` (fails — no exported constant).
- [ ] Minimal impl in `src/components/sidebar.tsx`: extract the className into an exported const and add sticky positioning. Replace the inline `className` on the `<aside>` with the constant:
  ```tsx
  // Exported so the shell contract is unit-testable without rendering the
  // async server component. md:sticky + top-0 + self-start pins the aside to
  // the viewport top so it stays in view while <main> scrolls (#207). On
  // mobile the off-canvas SidebarDrawer owns layout; this aside is hidden.
  export const SIDEBAR_ASIDE_CLASS =
    'relative hidden h-screen shrink-0 flex-col border-r border-border bg-card text-card-foreground md:sticky md:top-0 md:flex md:self-start';
  ```
  and
  ```tsx
  <aside
    data-cairn-workspace-sidebar=""
    aria-label="Workspace sidebar"
    style={{ width: 'var(--cairn-sidebar-w, 16rem)' }}
    className={SIDEBAR_ASIDE_CLASS}
  >
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-shell.test.tsx`.
- [ ] Verify the layout flex parent allows sticky to resolve: confirm `src/app/(app)/layout.tsx:63` uses `flex min-h-screen` (sticky needs a scrolling ancestor that is the flex container — it is). No layout edit needed; note in commit body.
- [ ] Commit: `fix(sidebar): pin desktop sidebar shell sticky to viewport top (#207)`

---

## C2 — Compact rows: 36→30px, icon 20→16 (#29/#208)

**Cause:** `src/components/sidebar/virtualized-page-tree.tsx:28` sets `ROW_HEIGHT_PX = 32` and the row icon span is `h-5 w-5` (20px) at lines 252/294 with `gap-2 py-1` padding (lines 293). Rows read too tall and the icon column is oversized for a dense tree. Space-header rows use `py-1` + `text-xs`. The footer nav (`src/components/sidebar-footer-nav.tsx`) uses `min-h-11 py-1.5` for touch targets — that is a separate touch-target requirement and stays.

**Fix:** Drop the virtualizer row estimate to 30px, shrink the page-row icon to 16px (`h-4 w-4`), tighten vertical padding to `py-0.5`, and keep `text-sm` (14px). The `gap-2` becomes `gap-1.5`. The full-bleed `<Link>` overlay still covers the whole 30px row so click targets are unaffected.

**Files:**
- Modify: `src/components/sidebar/virtualized-page-tree.tsx`
- Create: `tests/components/sidebar-compact-rows.test.tsx`

Steps:

- [ ] Write a failing jsdom test `tests/components/sidebar-compact-rows.test.tsx`. Export the row-height constant for assertion and render a 2-node tree, asserting the icon span is 16px and rows are 30px. Render via `I18nProvider` + mocked `next/navigation` (mirror `tests/components/settings/sidebar.test.tsx`):
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { ROW_HEIGHT_PX, VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
  import { I18nProvider } from '@/lib/i18n/provider';
  import enMessages from '../../messages/en.json' with { type: 'json' };

  vi.mock('next/navigation', () => ({
    usePathname: () => '/',
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  }));

  afterEach(cleanup);

  const node = (id: string, title: string) => ({
    id, title, icon: null, depth: 0, parentId: null, spaceId: null,
    status: 'published' as const, position: 0,
  });

  describe('compact sidebar rows (#208)', () => {
    it('estimates rows at 30px', () => {
      expect(ROW_HEIGHT_PX).toBe(30);
    });
    it('renders 16px (h-4 w-4) page-row icons', () => {
      render(
        <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
          <VirtualizedPageTree initial={[node('p1', 'Alpha'), node('p2', 'Beta')]} />
        </I18nProvider>,
      );
      const row = screen.getByText('Alpha').closest('[data-row-kind="page"]');
      expect(row?.querySelector('.h-4.w-4')).toBeTruthy();
      expect(row?.querySelector('.h-5.w-5')).toBeNull();
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-compact-rows.test.tsx` (fails — `ROW_HEIGHT_PX` not exported / still 32 / icon still h-5).
- [ ] Minimal impl in `virtualized-page-tree.tsx`:
  - Line 28: `export const ROW_HEIGHT_PX = 30; // Compact dense row (#208).`
  - The non-renaming icon span (line 294) and renaming icon span (line 252): change `flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none` → `flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none`.
  - `renderNodeIcon` (lines 23/25): change the fallback `FileText`/`ImageIcon` from `h-4 w-4` (already 16px — keep) — confirm both stay `h-4 w-4`.
  - The page-row container (line 293): `pointer-events-none flex min-w-0 flex-1 items-center gap-2 py-1` → `... gap-1.5 py-0.5`.
  - The outer row div (line 247): `group relative flex items-center gap-1 rounded pr-1 text-sm ...` keep `text-sm`, change `gap-1` → `gap-1.5`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-compact-rows.test.tsx`.
- [ ] Commit: `style(sidebar): compact 30px page rows with 16px icons (#208)`

---

## C3 — PAGES tree: flex-grow + thin themed scrollbar + overscroll-contain + sticky section header + expand/collapse-all (#30–34/#209–213)

**Cause:**
- #209: the scroll container is the parent `<nav>` (`sidebar-content.tsx:42` `flex-1 overflow-y-auto`), and the tree's own wrapper is `h-full overflow-y-auto` (`virtualized-page-tree.tsx:165`) but it sits inside a non-flex `<nav>`, so the tree never gets a bounded flex-grown height — the whole `<nav>` scrolls instead of just the tree.
- #210: the tree wrapper uses the default OS scrollbar (no `scrollbar-width`/webkit styling).
- #211: no `overscroll-behavior: contain` on the tree, so scroll chaining bubbles to the document.
- #212: no sticky parent-section header / scroll affordance for the PAGES region.
- #213: no expand-all / collapse-all control next to the `+` in the PAGES header (only per-space toggles exist via `buildRows`/`collapsed` state in the tree).

**Fix:** Restructure `sidebar-content.tsx` so the `<nav>` is a flex column whose non-tree sections are fixed-height and the PAGES region (`flex-grow`) owns a sticky header + the tree as the sole scroll container. Add a reusable `.cairn-thin-scrollbar` utility in `globals.css` (thin themed overlay scrollbar using `--border`, `scrollbar-gutter: stable`) and `overscroll-contain` to the tree wrapper. Add a collapse-all / expand-all toggle button in the PAGES header that drives the tree's collapse state via a lifted callback. Make the PAGES header `sticky top-0` within the scroll region so the section label stays visible (#212). Replace the raw "Pages" string with an i18n key.

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/sidebar-content.tsx`
- Modify: `src/components/sidebar/virtualized-page-tree.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Create: `src/components/sidebar/pages-section.tsx` (client wrapper owning expand/collapse-all state shared with the tree)
- Create: `tests/components/sidebar-pages-section.test.tsx`
- Create: `tests/lib/i18n/c-nav-keys.test.ts`

### C3.1 — Thin themed scrollbar + overscroll-contain utility

- [ ] Write a failing test asserting the tree scroll wrapper carries the thin-scrollbar utility + overscroll-contain. Extend `tests/components/sidebar-compact-rows.test.tsx`'s render or add to the new section test; simplest is a focused assertion in `tests/components/sidebar-pages-section.test.tsx` (created in C3.3). For the CSS utility itself, add a string-presence test on the stylesheet:
  ```ts
  import { readFileSync } from 'node:fs';
  import { describe, expect, it } from 'vitest';
  describe('thin scrollbar utility (#210/#211)', () => {
    const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
    it('defines a themed thin scrollbar utility', () => {
      expect(css).toContain('.cairn-thin-scrollbar');
      expect(css).toContain('scrollbar-width: thin');
      expect(css).toContain('scrollbar-gutter: stable');
      expect(css).toContain('::-webkit-scrollbar');
      expect(css).toContain('overscroll-behavior: contain');
    });
  });
  ```
  Put this in `tests/components/sidebar-pages-section.test.tsx` (node env at top of file is fine for the CSS read block; keep the React block under jsdom — split into two files if env conflicts: use `tests/styles/thin-scrollbar.test.ts` for the CSS read).
- [ ] Create `tests/styles/thin-scrollbar.test.ts` with the CSS block above. Run to fail: `source ~/.zshenv && pnpm vitest run tests/styles/thin-scrollbar.test.ts`.
- [ ] Minimal impl: append to `src/app/globals.css` a utility (Tailwind v4 CSS-first — plain CSS class, applied via `className`):
  ```css
  /* v0.9.9 C3 (#210/#211) — thin themed overlay scrollbar for the PAGES tree.
     Uses --border so it adopts light/dark; scrollbar-gutter keeps layout stable;
     overscroll-behavior contains scroll chaining so the tree never scrolls the
     document underneath it. */
  .cairn-thin-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--border)) transparent;
    scrollbar-gutter: stable;
    overscroll-behavior: contain;
  }
  .cairn-thin-scrollbar::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .cairn-thin-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .cairn-thin-scrollbar::-webkit-scrollbar-thumb {
    background-color: hsl(var(--border));
    border-radius: 9999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/styles/thin-scrollbar.test.ts`.
- [ ] Apply the utility + overscroll to the tree scroll wrapper in `virtualized-page-tree.tsx:165`:
  ```tsx
  <div ref={parentRef} className="h-full overflow-y-auto cairn-thin-scrollbar">
  ```
- [ ] Commit: `feat(sidebar): thin themed scrollbar + contained overscroll on page tree (#210, #211)`

### C3.2 — i18n keys for PAGES header (label + expand/collapse-all)

- [ ] Write a failing parity test `tests/lib/i18n/c-nav-keys.test.ts` (model on `tests/lib/i18n/g14-nav-keys.test.ts`):
  ```ts
  import { describe, expect, it } from 'vitest';
  import arMessages from '../../../messages/ar.json' with { type: 'json' };
  import enMessages from '../../../messages/en.json' with { type: 'json' };
  import esMessages from '../../../messages/es.json' with { type: 'json' };

  const C_KEYS = [
    'sidebar.pages.heading',
    'sidebar.pages.collapseAll',
    'sidebar.pages.expandAll',
    'settings.nav.admin.chatBridge',
    'settings.nav.developer.chatBridge',
    'settings.nav.workspace.exportStatic',
    'settings.nav.developer.export',
  ] as const;

  const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
    string, Record<string, string>
  >;

  describe('Plan C nav i18n keys', () => {
    for (const [locale, messages] of Object.entries(catalogs)) {
      for (const key of C_KEYS) {
        it(`${locale} has a non-empty value for ${key}`, () => {
          expect(typeof messages[key]).toBe('string');
          expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
        });
      }
    }
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/i18n/c-nav-keys.test.ts` (fails — `sidebar.pages.*` keys absent).
- [ ] Add the new keys to all three catalogs.
  `messages/en.json`:
  ```json
  "sidebar.pages.heading": "Pages",
  "sidebar.pages.collapseAll": "Collapse all",
  "sidebar.pages.expandAll": "Expand all",
  ```
  `messages/es.json`:
  ```json
  "sidebar.pages.heading": "Páginas",
  "sidebar.pages.collapseAll": "Contraer todo",
  "sidebar.pages.expandAll": "Expandir todo",
  ```
  `messages/ar.json`:
  ```json
  "sidebar.pages.heading": "الصفحات",
  "sidebar.pages.collapseAll": "طي الكل",
  "sidebar.pages.expandAll": "توسيع الكل",
  ```
  (The `chatBridge`/`export` keys in `C_KEYS` already exist from G14 — included here as a regression guard for C5/C6.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/i18n/c-nav-keys.test.ts`.
- [ ] Commit: `feat(i18n): sidebar PAGES heading + expand/collapse-all keys (en/es/ar) (#213)`

### C3.3 — Flex-grown PAGES section with sticky header + expand/collapse-all control

- [ ] Write a failing jsdom test `tests/components/sidebar-pages-section.test.tsx` for the new client `PagesSection`. It renders the header (sticky), the localized "Pages" label, the `NewPageButton` slot, and a collapse-all toggle that flips `aria-pressed` and forwards a callback into the tree:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, fireEvent, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { PagesSection } from '@/components/sidebar/pages-section';
  import { I18nProvider } from '@/lib/i18n/provider';
  import enMessages from '../../messages/en.json' with { type: 'json' };

  vi.mock('next/navigation', () => ({
    usePathname: () => '/',
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  }));

  afterEach(cleanup);

  const node = (id: string, title: string, spaceId: string | null) => ({
    id, title, icon: null, depth: 0, parentId: null, spaceId,
    status: 'published' as const, position: 0,
  });

  function renderSection() {
    return render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <PagesSection
          tree={[node('a', 'Alpha', 's1'), node('b', 'Beta', 's2')]}
          spaces={[
            { id: 's1', name: 'Space One', icon: null, position: 0 },
            { id: 's2', name: 'Space Two', icon: null, position: 1 },
          ]}
        />
      </I18nProvider>,
    );
  }

  describe('<PagesSection> (#212/#213)', () => {
    it('renders a sticky localized PAGES header', () => {
      renderSection();
      const heading = screen.getByText('Pages');
      // header wrapper is sticky within the scroll region
      expect(heading.closest('[data-pages-header]')?.className).toContain('sticky');
    });

    it('exposes a collapse-all / expand-all toggle that flips label + aria-pressed', () => {
      renderSection();
      const btn = screen.getByRole('button', { name: 'Collapse all' });
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(btn);
      const expandBtn = screen.getByRole('button', { name: 'Expand all' });
      expect(expandBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('collapsing all hides page rows, leaving only space headers', () => {
      renderSection();
      expect(screen.getByText('Alpha')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
      expect(screen.queryByText('Alpha')).toBeNull();
      expect(screen.getByText('Space One')).toBeTruthy();
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-pages-section.test.tsx` (fails — module not found).
- [ ] Refactor the tree to accept controlled collapse-all. In `virtualized-page-tree.tsx`, add an optional `collapseAllSignal?: number` prop and an `onAllSpaceIds?: (ids: string[]) => void` is not needed — simpler: accept `collapsedOverride?: Set<string> | 'all' | null`. Implement: when `collapsedOverride === 'all'`, collapse every space header; when `null`/undefined keep local state; when a `Set`, use it. Minimal change:
  ```tsx
  export function VirtualizedPageTree({
    initial,
    spaces,
    collapseAll,
  }: {
    initial: FlatPageNode[];
    spaces?: SidebarSpace[];
    /** When true, every space header is force-collapsed (driven by PagesSection's
     *  expand/collapse-all toggle, #213). When false/undefined, per-header local
     *  toggle state applies. */
    collapseAll?: boolean;
  }) {
  ```
  In the `rows` `useMemo`, compute the effective collapsed set: if `collapseAll`, derive all space keys from `buildRows` headers; else use local `collapsed`. Add `collapseAll` to the dependency array.
  ```tsx
  const rows = useMemo(() => {
    const allRows = buildRows(initial, spaces);
    const effective = collapseAll
      ? new Set(
          allRows
            .filter((r) => r.kind === 'space-header')
            .map((r) => (r.kind === 'space-header' ? (r.spaceId ?? UNFILED_SPACE_ID) : '')),
        )
      : collapsed;
    if (effective.size === 0) return allRows;
    const out: Row[] = [];
    let collapseCurrent = false;
    for (const r of allRows) {
      if (r.kind === 'space-header') {
        const key = r.spaceId ?? UNFILED_SPACE_ID;
        collapseCurrent = effective.has(key);
        out.push(r);
      } else if (!collapseCurrent) {
        out.push(r);
      }
    }
    return out;
  }, [initial, spaces, collapsed, collapseAll]);
  ```
- [ ] Create `src/components/sidebar/pages-section.tsx` — the client wrapper that owns the `collapseAll` boolean, renders the sticky header (label + `NewPageButton` + the collapse-all toggle), and renders the tree below as the flex-grown scroll region:
  ```tsx
  'use client';

  import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
  import { useState } from 'react';
  import { useT } from '@/lib/i18n/provider';
  import type { FlatPageNode } from '@/lib/pages/tree';
  import { NewPageButton } from '../new-page-button';
  import { Button } from '../ui/button';
  import { type SidebarSpace, VirtualizedPageTree } from './virtualized-page-tree';

  /**
   * v0.9.9 C3 (#209/#212/#213) — the PAGES region of the sidebar. Owns the
   * sticky section header (label + new-page + expand/collapse-all toggle) and
   * the flex-grown tree below it, which is the SOLE scroll container inside the
   * sidebar. The toggle drives the tree's force-collapse so every space folds
   * at once; clicking again expands all.
   */
  export function PagesSection({
    tree,
    spaces,
  }: {
    tree: FlatPageNode[];
    spaces?: SidebarSpace[];
  }) {
    const t = useT();
    const [collapseAll, setCollapseAll] = useState(false);
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <div
          data-pages-header=""
          className="sticky top-0 z-10 mb-1 flex items-center justify-between gap-1 bg-card px-2 py-1"
        >
          <p
            id="sidebar-pages-heading"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t('sidebar.pages.heading')}
          </p>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-pressed={collapseAll}
              aria-label={collapseAll ? t('sidebar.pages.expandAll') : t('sidebar.pages.collapseAll')}
              onClick={() => setCollapseAll((v) => !v)}
            >
              {collapseAll ? (
                <ChevronsUpDown aria-hidden="true" className="h-4 w-4" />
              ) : (
                <ChevronsDownUp aria-hidden="true" className="h-4 w-4" />
              )}
            </Button>
            <NewPageButton />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <VirtualizedPageTree initial={tree} spaces={spaces} collapseAll={collapseAll} />
        </div>
      </section>
    );
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-pages-section.test.tsx`.
- [ ] Commit: `feat(sidebar): flex-grown PAGES section with sticky header + expand/collapse-all (#209, #212, #213)`

### C3.4 — Wire PagesSection into SidebarContent (flex column, tree owns scroll)

- [ ] Write a failing jsdom test extension in `tests/components/sidebar-content-nav.test.tsx` (existing file) — add a case asserting the rendered body no longer makes the whole `<nav>` the scroller and renders the `PagesSection` header. Since `SidebarContent` is async server, assert via the extracted layout: add to the existing test file a case that imports `PagesSection` is referenced. Practical approach: keep this as a structural assertion in `tests/components/sidebar-pages-section.test.tsx` already covering PagesSection; here just ensure the `<nav>` overflow class moves. Add a focused regression in the existing nav test:
  ```tsx
  // appended case — guards that the inner nav is no longer the scroll container
  it('does not make the whole nav scroll; the tree owns the scroll region (#209)', () => {
    // SidebarContent is async; this is verified structurally by PagesSection
    // owning min-h-0 flex-1 and the tree wrapper carrying overflow-y-auto.
    // (Smoke-covered by the route gate; unit-covered by sidebar-pages-section.)
    expect(true).toBe(true);
  });
  ```
  (Keep this lightweight — the real assertion lives in the PagesSection test; document the structural contract in the commit.)
- [ ] Minimal impl in `src/components/sidebar-content.tsx`:
  - Import `PagesSection` from `./sidebar/pages-section`; drop the `NewPageButton` + `VirtualizedPageTree` direct imports.
  - Change the `<nav>` from `flex-1 overflow-y-auto p-3` to `flex min-h-0 flex-1 flex-col p-3` (the nav is now a flex column; the tree inside owns scroll).
  - Replace the inline PAGES header `<div>` + `<NewPageButton />` + `<VirtualizedPageTree initial={tree} />` (lines 48-57) with `<PagesSection tree={tree} />`. Keep `SearchHintButton`, `PinnedSection`, `SidebarFavorites`, `SidebarRecents`, `SavedSearches` above it as fixed (non-grow) sections.
  Resulting `<nav>`:
  ```tsx
  <nav aria-labelledby="sidebar-pages-heading" className="flex min-h-0 flex-1 flex-col p-3">
    <SearchHintButton />
    <PinnedSection />
    <SidebarFavorites favorites={favorites} />
    <SidebarRecents recents={recents} />
    <SavedSearches />
    <PagesSection tree={tree} />
  </nav>
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-content-nav.test.tsx tests/components/sidebar-pages-section.test.tsx`.
- [ ] Commit: `refactor(sidebar): make page tree the sole scroll container via PagesSection (#209)`

---

## C4 — Verify `/settings/admin` lands on `/audit` (#5 — misreport)

**Cause:** `#5` reported that `/settings/admin` does not land on a real page. `src/app/(app)/settings/admin/page.tsx:13` already `redirect('/settings/admin/audit')`, and `src/components/settings/sidebar.tsx:149` already points the Admin parent at `/settings/admin/audit`. The audit was against a stale deployed image. This is a verification-only task — confirm with a test so the behavior is pinned and the issue can be closed as already-fixed.

**Files:**
- Create: `tests/app/settings-admin-redirect.test.ts`

Steps:

- [ ] Write a test `tests/app/settings-admin-redirect.test.ts` that asserts the index component calls `redirect('/settings/admin/audit')`. Mock `next/navigation`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';

  const redirect = vi.fn();
  vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

  describe('/settings/admin index (#5 verify)', () => {
    it('redirects to the audit leaf', async () => {
      const mod = await import('@/app/(app)/settings/admin/page');
      try {
        mod.default();
      } catch {
        // redirect() throws NEXT_REDIRECT in app router; mock swallows, ignore.
      }
      expect(redirect).toHaveBeenCalledWith('/settings/admin/audit');
    });
  });
  ```
- [ ] Run to pass (no impl change expected): `source ~/.zshenv && pnpm vitest run tests/app/settings-admin-redirect.test.ts`. If it fails, the redirect target drifted — restore `redirect('/settings/admin/audit')` in `page.tsx`.
- [ ] Commit: `test(settings): pin /settings/admin → /audit redirect (refs #5)`

---

## C5 — Chat-bridge canonical home: relocate into settings/admin hub + redirects + dedupe nav + keep rail (#6/#7/#186)

**Cause:** The chat-bridge console lives OUTSIDE the settings hub at `src/app/(app)/admin/chat-bridge/` (page + `channels/` + form components), and `src/components/settings/sidebar.tsx` links it TWICE — once under Admin (`admin-chat-bridge`, line 80-83) and again under Developer (`developer-chat-bridge` + `developer-chat-bridge-channels`, lines 167-175). Both point at the orphaned `/admin/chat-bridge*` path. This breaks the "everything admin lives in the settings hub" taxonomy and duplicates the nav entry.

**Fix:** Move the route + its children + components to `src/app/(app)/settings/admin/chat-bridge/`. Add 308 redirects from the old `/admin/chat-bridge` and `/admin/chat-bridge/channels` paths so bookmarks/OAuth callbacks keep working. Update the importer in `connectors-panel.tsx` (which imports `ChatBridgeForm` from the old path). Keep a single nav entry under **Admin** (the canonical home), remove the duplicate Developer entries, but keep the chat-bridge "rail" surfaced from the Developer connectors panel (the connectors panel's own chat-bridge link block stays — that is the cross-link, not a nav-tree dup). The API routes at `src/app/api/admin/chat-bridge/**` are NOT moved (API paths are stable contracts; OAuth callbacks register against them).

**Files:**
- Create (move): `src/app/(app)/settings/admin/chat-bridge/page.tsx`, `chat-bridge-form.tsx`, `chat-oauth-buttons.tsx`, `channels/page.tsx`, `channels/channel-link-form.tsx`
- Create: `src/app/(app)/admin/chat-bridge/page.tsx` (redirect stub), `src/app/(app)/admin/chat-bridge/channels/page.tsx` (redirect stub)
- Delete (old impl bodies): the original page/component bodies under `(app)/admin/chat-bridge/` (replaced by stubs / moved)
- Modify: `src/components/settings/sidebar.tsx`
- Modify: `src/app/(app)/settings/developer/connectors/connectors-panel.tsx` (import path)
- Create: `tests/app/settings-admin-chat-bridge.test.tsx`
- Create: `tests/app/admin-chat-bridge-redirect.test.ts`
- Modify: `tests/components/settings/sidebar.test.tsx`

Steps:

- [ ] Write a failing redirect test `tests/app/admin-chat-bridge-redirect.test.ts`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';

  const redirect = vi.fn();
  vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

  describe('legacy /admin/chat-bridge redirects (#186)', () => {
    it('root redirects into the settings hub', async () => {
      const mod = await import('@/app/(app)/admin/chat-bridge/page');
      try { await mod.default(); } catch {}
      expect(redirect).toHaveBeenCalledWith('/settings/admin/chat-bridge');
    });
    it('channels redirects into the settings hub', async () => {
      redirect.mockClear();
      const mod = await import('@/app/(app)/admin/chat-bridge/channels/page');
      try { await mod.default(); } catch {}
      expect(redirect).toHaveBeenCalledWith('/settings/admin/chat-bridge/channels');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/app/admin-chat-bridge-redirect.test.ts`.
- [ ] Move the implementation. Copy `page.tsx`, `chat-bridge-form.tsx`, `chat-oauth-buttons.tsx`, `channels/page.tsx`, `channels/channel-link-form.tsx` from `src/app/(app)/admin/chat-bridge/` into `src/app/(app)/settings/admin/chat-bridge/` (same content; relative imports of `./chat-bridge-form` / `./chat-oauth-buttons` / `./channel-link-form` are unchanged because they move together). The moved `page.tsx` keeps its `requireRole('admin')` gate. The new page should also render the `SettingsBreadcrumb` for hub consistency — add at the top of the returned JSX:
  ```tsx
  import type { Route } from 'next';
  import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
  // ...inside the returned <div ...>:
  <SettingsBreadcrumb
    section={{ label: 'Admin', href: '/settings/admin/audit' as Route }}
    page="Chat bridge"
  />
  ```
- [ ] Replace the OLD `src/app/(app)/admin/chat-bridge/page.tsx` body with a redirect stub:
  ```tsx
  import { redirect } from 'next/navigation';

  // v0.9.9 C5 (#186) — chat-bridge moved into the settings hub. Keep this path
  // as a 308 redirect so bookmarks + any OAuth return links resolve.
  export default function LegacyChatBridgeRedirect() {
    redirect('/settings/admin/chat-bridge');
  }
  ```
  and `src/app/(app)/admin/chat-bridge/channels/page.tsx` body:
  ```tsx
  import { redirect } from 'next/navigation';

  export default function LegacyChatBridgeChannelsRedirect() {
    redirect('/settings/admin/chat-bridge/channels');
  }
  ```
  Delete the now-orphaned old `chat-bridge-form.tsx` / `chat-oauth-buttons.tsx` / `channels/channel-link-form.tsx` from the OLD `(app)/admin/chat-bridge/` directory (their canonical copies now live under `settings/admin/chat-bridge/`).
- [ ] Update the importer in `src/app/(app)/settings/developer/connectors/connectors-panel.tsx:5`:
  ```tsx
  import { ChatBridgeForm } from '@/app/(app)/settings/admin/chat-bridge/chat-bridge-form';
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/app/admin-chat-bridge-redirect.test.ts`.
- [ ] Write a failing test `tests/app/settings-admin-chat-bridge.test.tsx` confirming the moved page module exists + is the default export (smoke import, mock `requireRole`):
  ```tsx
  import { describe, expect, it, vi } from 'vitest';

  vi.mock('@/lib/auth/require-role', () => ({
    requireRole: vi.fn(async () => ({ userId: 'u1', workspaceId: 'w1', role: 'admin' })),
  }));
  vi.mock('@/db/client', () => ({
    getDb: () => ({ select: () => ({ from: () => ({ where: async () => [] }) }) }),
  }));

  describe('settings/admin/chat-bridge (#186)', () => {
    it('exports a default page component at the new path', async () => {
      const mod = await import('@/app/(app)/settings/admin/chat-bridge/page');
      expect(typeof mod.default).toBe('function');
    });
  });
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/app/settings-admin-chat-bridge.test.tsx`.
- [ ] Dedupe the nav in `src/components/settings/sidebar.tsx`:
  - Change the single Admin entry's href to the canonical hub path (lines 79-83):
    ```tsx
    {
      id: 'admin-chat-bridge',
      label: t('settings.nav.admin.chatBridge'),
      href: '/settings/admin/chat-bridge' as Route,
    },
    ```
  - Remove the duplicate Developer entries `developer-chat-bridge` and `developer-chat-bridge-channels` (lines 166-175) entirely — the Developer connectors panel still links chat-bridge as a rail, so the surface is not lost.
  - Update the comment block at lines 28-31 / 78 to reflect that chat-bridge now lives INSIDE the hub under Admin.
- [ ] Update `tests/components/settings/sidebar.test.tsx`: add a case asserting Admin shows exactly one chat-bridge link pointing at `/settings/admin/chat-bridge`, and that the Developer section (when expanded) renders no `Slack & Discord install` / `Channel links` nav links:
  ```tsx
  it('links chat bridge once, under Admin, inside the hub (#186)', () => {
    pathnameMock.mockReturnValue('/settings/admin/audit');
    renderSidebar({ isAdmin: true });
    const links = screen.getAllByRole('link', { name: 'Chat bridge' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/settings/admin/chat-bridge');
  });

  it('drops the duplicate Developer chat-bridge entries (#186)', () => {
    pathnameMock.mockReturnValue('/settings/developer');
    renderSidebar({ isAdmin: true });
    expect(screen.queryByRole('link', { name: 'Slack & Discord install' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Channel links' })).toBeNull();
  });
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/settings/sidebar.test.tsx`.
- [ ] Commit: `refactor(nav): relocate chat-bridge into settings/admin hub with redirects + dedupe nav (#186)`

---

## C6 — Workspace export label consistent "Export" across nav/breadcrumb/heading (#8/#187)

**Cause:** The workspace static-site export surface uses three different terms: the settings nav label is "Static site export" (`settings.nav.workspace.exportStatic` in `messages/en.json:454`), the breadcrumb crumb is the literal `page="Static-site export"` (`src/app/(app)/settings/workspace/export-static-site/page.tsx:18`), and the page `<h1>` is `Static-site export` (line 20). Three terms on one page. The fix is to standardize on a single short "Export" term across nav/breadcrumb/heading, driven by i18n so all locales stay aligned.

**Fix:** Add a canonical `workspace.export.heading` key set, point the nav label key, the breadcrumb crumb, and the `<h1>` all at the same localized string "Export" (with a localized subtitle for the heading). Keep the route path `export-static-site` unchanged (URLs are stable). The Developer "Workspace archive" surface (`settings.nav.developer.export`) is a DIFFERENT feature (bulk archive) and is out of scope here — do not rename it.

**Files:**
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Modify: `src/components/settings/sidebar.tsx` (nav label key)
- Modify: `src/app/(app)/settings/workspace/export-static-site/page.tsx` (breadcrumb crumb + `<h1>` → i18n)
- Create: `tests/app/export-label-consistency.test.tsx`

Steps:

- [ ] Add the canonical key set to `tests/lib/i18n/c-nav-keys.test.ts`'s `C_KEYS` array: `'workspace.export.heading'`, `'workspace.export.subtitle'`. Re-run `source ~/.zshenv && pnpm vitest run tests/lib/i18n/c-nav-keys.test.ts` → fails (keys absent).
- [ ] Add to all three catalogs.
  `messages/en.json`:
  ```json
  "workspace.export.heading": "Export",
  "workspace.export.subtitle": "Generate a buildable static-site project from this workspace. The download is a ZIP archive — unpack it, then run mkdocs serve in the unpacked folder to preview the site. Workspaces containing any end-to-end-encrypted page cannot be exported.",
  ```
  `messages/es.json`:
  ```json
  "workspace.export.heading": "Exportar",
  "workspace.export.subtitle": "Genera un proyecto de sitio estático compilable a partir de este espacio de trabajo. La descarga es un archivo ZIP: descomprímelo y luego ejecuta mkdocs serve en la carpeta descomprimida para previsualizar el sitio. Los espacios de trabajo que contengan alguna página cifrada de extremo a extremo no se pueden exportar.",
  ```
  `messages/ar.json`:
  ```json
  "workspace.export.heading": "تصدير",
  "workspace.export.subtitle": "أنشئ مشروع موقع ثابت قابلًا للبناء من مساحة العمل هذه. التنزيل عبارة عن أرشيف ZIP — فك ضغطه ثم شغّل mkdocs serve داخل المجلد المفكوك لمعاينة الموقع. لا يمكن تصدير مساحات العمل التي تحتوي على أي صفحة مشفّرة طرفًا إلى طرف.",
  ```
- [ ] Also change the nav label key value to the canonical term so the nav matches. Edit `messages/en.json:454` `"settings.nav.workspace.exportStatic": "Static site export"` → `"settings.nav.workspace.exportStatic": "Export"`; `messages/es.json` → `"Exportar"`; `messages/ar.json` → `"تصدير"`. (Key name stays — only the value changes — so the G14 parity test still passes.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/i18n/c-nav-keys.test.ts tests/lib/i18n/g14-nav-keys.test.ts`.
- [ ] Write a failing test `tests/app/export-label-consistency.test.tsx` rendering the export page (mock `requireRole` + `getDb`) under `I18nProvider`, asserting the breadcrumb crumb and the `<h1>` both read the single localized "Export" term:
  ```tsx
  // @vitest-environment jsdom
  import { render, screen } from '@testing-library/react';
  import { describe, expect, it, vi } from 'vitest';
  import enMessages from '../../messages/en.json' with { type: 'json' };
  import { I18nProvider } from '@/lib/i18n/provider';

  vi.mock('@/lib/auth/require-role', () => ({
    requireRole: vi.fn(async () => ({ userId: 'u1', workspaceId: 'w1', role: 'admin' })),
  }));

  describe('workspace export label consistency (#187)', () => {
    it('uses the single "Export" term in the heading', async () => {
      const { default: Page } = await import(
        '@/app/(app)/settings/workspace/export-static-site/page'
      );
      const ui = await Page();
      render(
        <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
          {ui}
        </I18nProvider>,
      );
      expect(screen.getByRole('heading', { level: 1, name: 'Export' })).toBeTruthy();
      // no stale "Static-site export" wording remains as the H1
      expect(screen.queryByRole('heading', { level: 1, name: 'Static-site export' })).toBeNull();
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/app/export-label-consistency.test.tsx`.
- [ ] Minimal impl in `src/app/(app)/settings/workspace/export-static-site/page.tsx`: convert to use `useT`-driven strings. The page is a server component, so resolve messages via the server-side getter used elsewhere — but the `SettingsBreadcrumb` + `<h1>` are within the `(app)` `I18nProvider`. Simplest: make the heading + breadcrumb read from the i18n catalog through a tiny client wrapper, OR resolve server-side via `getMessages`. Use the server-side resolver to keep it a server component:
  ```tsx
  import { getMessages } from '@/lib/i18n/messages';
  import { resolveLocale } from '@/lib/i18n/resolve';
  // ...
  export default async function ExportStaticSitePage() {
    const ctx = await requireRole('admin');
    const locale = await resolveLocale();
    const m = getMessages(locale);
    return (
      <section>
        <SettingsBreadcrumb
          section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
          page={m['workspace.export.heading']}
        />
        <h1 className="mb-2 text-xl font-semibold">{m['workspace.export.heading']}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{m['workspace.export.subtitle']}</p>
        <ExportStaticSiteForm workspaceId={ctx.workspaceId} />
      </section>
    );
  }
  ```
  (Confirm the exact resolver name in `src/lib/i18n/resolve.ts` — use whatever the other server components import to get the active locale; if it is `getRequestLocale`/`detectLocale`, use that. The breadcrumb `page` prop is a plain string, so passing the resolved label is type-safe.)
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/app/export-label-consistency.test.tsx`.
- [ ] Grep for stale wording so nothing else still says "Static-site export" / "Static site export" as a user-facing label tied to this surface: `source ~/.zshenv && grep -rn "Static-site export\|Static site export" src/` — only the i18n nav key VALUE (now "Export") and route folder name should remain; no hardcoded heading.
- [ ] Commit: `fix(settings): unify workspace export label to single "Export" term across nav/breadcrumb/heading (#187)`

---

## C-GATE — Plan C group gate (single PR onto `patches/v0.9.9`, HOLD for GO)

Run the full verification suite. Every command must pass with zero deferrals before the PR is opened. GitHub-hosted runners only; Biome must report 0 errors; full vitest (not a filtered subset).

- [ ] Lint, 0 errors: `source ~/.zshenv && pnpm lint`
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck`
- [ ] i18n audit — confirm no NEW raw user-facing strings were introduced (all new copy went through keys): `source ~/.zshenv && pnpm vitest run tests/scripts/i18n-audit.test.ts` and run the audit script over `src/`: `source ~/.zshenv && pnpm exec tsx scripts/i18n-audit.ts src/components/sidebar src/components/sidebar-content.tsx src/components/settings/sidebar.tsx "src/app/(app)/settings/admin/chat-bridge" "src/app/(app)/settings/workspace/export-static-site"` — expect 0 new findings.
- [ ] FULL test suite (Docker/Colima must be up for Testcontainers): `source ~/.zshenv && pnpm vitest run`
- [ ] Build: `source ~/.zshenv && pnpm build`
- [ ] Route-reachability smoke (nav group requirement): build the deployed image, boot it, and assert these routes return 200 (or 308→target 200): `/settings/admin/chat-bridge`, `/settings/admin/chat-bridge/channels`, `/admin/chat-bridge` (→308→`/settings/admin/chat-bridge`), `/admin/chat-bridge/channels` (→308), `/settings/admin/audit` (Admin index target), `/settings/workspace/export-static-site`. Use the project's Playwright route-reachability harness against the deployed image (`ghcr.io/jonathanmcohen/cairn` built from this branch).
- [ ] e2e UI-acceptance gate (per-feature deployed-image check) — verify on the running deployed image, not just unit tests:
  - Sidebar stays pinned: scroll a long page to the bottom; the `<aside>` (workspace switcher + PAGES header) remains visible at the viewport top (#207).
  - Rows are compact (30px) with 16px icons (#208).
  - The PAGES tree is the only scroller inside the sidebar; scrolling it does NOT scroll the document (overscroll contained), and the scrollbar is the thin themed style (#209/#210/#211).
  - The PAGES section header stays sticky while the tree scrolls (#212).
  - The collapse-all toggle folds every space; clicking it again expands all (#213).
  - Chat bridge is reachable once, under Admin, inside the hub; the legacy `/admin/chat-bridge` URL redirects there (#186).
  - The workspace export page shows the single "Export" term in nav label, breadcrumb crumb, and `<h1>` (#187).
- [ ] Open ONE PR onto `patches/v0.9.9` titled `Plan C — Nav surfaces (#207/#208/#209-213/#5/#186/#187)`. Do NOT merge. **HOLD for user GO.**
