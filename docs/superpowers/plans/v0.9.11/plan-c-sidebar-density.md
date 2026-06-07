# v0.9.11 Plan C — Sidebar density (text-size)

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Tighten sidebar information density on `patches/v0.9.11` via the **a11y-safe** path: shrink the sidebar *body text* (not interactive heights) and drop the default sidebar width. Three issues:

- **#130 (P1, a11y-safe):** sidebar body text 14px→13px, line-height 20px→18px, add 0.1px letter-spacing for legibility at 13px. Tokenize in `src/app/globals.css` `@theme`: `--cairn-sidebar-text: 13px`, `--cairn-sidebar-leading: 18px`. Apply the token (replacing each `text-sm`) to: PAGES-tree page-title rows (`src/components/sidebar/virtualized-page-tree.tsx`), saved-search entry rows (`src/components/sidebar/saved-searches.tsx`), the six utility nav links (`NAV_ITEM_CLASS` in `src/components/sidebar-footer-nav.tsx`), the workspace-switcher trigger ("Homelab"/active workspace name, `src/components/workspace-switcher.tsx`), and the "Sign out" button (`sidebar-footer-nav.tsx`). **KEEP `min-h-11` (the 44px WCAG 2.5.5 touch floor) on every interactive element — change only `font-size`/`line-height`, never the box height.** **KEEP section labels at 12px (`text-xs`)** and the `kbd`/badge at 10px (`text-[10px]`).
- **#131 (P1, free):** sidebar default width 256px→224px. `src/components/sidebar.tsx` is `width: var(--cairn-sidebar-w, 16rem)` — change the **fallback only** to `14rem`. Width is user-resizable + persisted by `SidebarResizeHandle`, so users who dragged a width keep it; only the pre-hydration / never-resized default changes.
- **#132 (P2, floored at 44px):** the command-palette trigger `src/components/search-hint-button.tsx:26` is `min-h-11 ... py-2` — change `py-2`→`py-1.5` (trims internal padding). **KEEP `min-h-11`** so the box stays ≥44px tall.

**Architecture:** The desktop sidebar is `<Sidebar>` (`src/components/sidebar.tsx`, an `<aside>` whose width is driven by the `--cairn-sidebar-w` CSS var with a `16rem` fallback). It and the mobile drawer share the presentational body `SidebarContent` (`src/components/sidebar-content.tsx`), a vertical flex column: `WorkspaceSwitcher` (fixed) → scrolling `<nav>` (`SearchHintButton`, pinned/favorites/recents, `SavedSearches`, `PagesSection` → the windowed `VirtualizedPageTree`) → `SidebarFooterNav` (fixed). Body link/title text currently renders at Tailwind `text-sm` (14px / 20px line-height) in five places; this plan introduces two CSS-first design tokens in the Tailwind v4 `@theme` block of `globals.css` and swaps each `text-sm` on those *body* surfaces for an explicit `text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px]` triplet. Section headings (`text-xs`, 12px) and the kbd/badge (`text-[10px]`) are deliberately untouched. This is purely CSS / className work — there is no schema, route, or logic change, and **no migration** (latest applied stays 0068).

**Tech Stack:** Next.js 16 App Router (React 19, TS6, `proxy.ts` auth gate), Tailwind v4 (CSS-first `@theme` in `src/app/globals.css`, **no `tailwind.config.*`**) + shadcn/ui, `@tanstack/react-virtual` for the page tree, Biome v2 (0 errors), Vitest 4 + Testcontainers (component tests run under `// @vitest-environment jsdom`), Playwright + `@axe-core/playwright` for the e2e a11y gate (`pnpm test:a11y` → `tests/a11y/mobile-touch-targets.spec.ts`), i18n en/es/ar via `useT()` over flat-key JSON in `messages/{en,es,ar}.json` (**this plan adds no new strings** — token/className only). Shell commands MUST be prefixed `source ~/.zshenv &&` (Homebrew/node/pnpm are not on PATH otherwise). All work lands on `patches/v0.9.11` as part of the single v0.9.11 PR. **HOLD for GO before merge; do not push.**

**A11y invariant (load-bearing for the whole plan):** `tests/a11y/mobile-touch-targets.spec.ts:43-66` measures every visible interactive element's `getBoundingClientRect()` and fails on any `r.width < 44 || r.height < 44`. A `font-size` / `line-height` / `letter-spacing` change does **not** shrink a box that has `min-h-11` (44px) set — the `min-height` wins over the reduced text. The width change (#131) only affects an `<aside>` (non-interactive) fallback. The `py-1.5` change (#132) keeps `min-h-11`. Therefore **the a11y gate must stay green**; the final task re-runs it as the safety net. (Note: that spec scopes its routes to `/settings/developer/*` + webhooks, none of which render the workspace sidebar, so it would not even *see* these elements — but we keep `min-h-11` regardless so density never costs touch-target compliance anywhere the sidebar appears.)

---

## C1 — Sidebar density tokens in `@theme` (#130)

**Cause:** There is no shared token for sidebar body text size/leading; each body surface hard-codes Tailwind `text-sm` (14px / 1.25rem≈20px line-height). The scope wants a single tokenized source so 14→13 / 20→18 is one edit and future tuning is centralized.

**Fix:** Add two custom properties to the Tailwind v4 `@theme inline { … }` block in `src/app/globals.css` (the block that already ends at the `--radius-*` group). Tailwind v4 reads `@theme` tokens at build; we reference them via arbitrary-value utilities in later tasks, so they only need to exist as CSS custom properties.

**Files:**
- Modify: `src/app/globals.css`
- Create: `tests/components/sidebar-density-tokens.test.ts`

Steps:

- [ ] Write a failing test `tests/components/sidebar-density-tokens.test.ts` that reads the raw CSS source and asserts both tokens exist with the exact target values (a file-content assertion is the practical check here — there is no DOM to compute against for a token *definition*):
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

  describe('sidebar density tokens (#130)', () => {
    it('defines the sidebar body text-size token at 13px', () => {
      expect(css).toMatch(/--cairn-sidebar-text:\s*13px/);
    });
    it('defines the sidebar line-height token at 18px', () => {
      expect(css).toMatch(/--cairn-sidebar-leading:\s*18px/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-tokens.test.ts` (fails — tokens absent).
- [ ] Minimal impl in `src/app/globals.css`: inside the existing `@theme inline { … }` block, immediately before the `--radius-lg:` line, add the two tokens with a comment:
  ```css
  /* v0.9.11 #130 — sidebar density. Body links/titles drop from text-sm
     (14px/20px) to 13px/18px with 0.1px tracking for legibility at the smaller
     size. Tokenized here so the size lives in one place. Section labels stay at
     12px (text-xs) and the kbd/badge at 10px — only BODY text shrinks. These
     change font only; interactive rows keep min-h-11 (44px touch floor), so the
     a11y touch-target gate is unaffected. */
  --cairn-sidebar-text: 13px;
  --cairn-sidebar-leading: 18px;
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-tokens.test.ts`.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(sidebar): add 13px/18px density tokens to @theme (#130)"`

---

## C2 — Apply density token to PAGES-tree page rows (#130)

**Cause:** `src/components/sidebar/virtualized-page-tree.tsx:262` sets the page row container to `text-sm` (14px). The row already carries `rounded pr-1 hover:bg-accent focus-within:bg-accent`; the rename-mode `<input>` (`:276`) is separately `text-sm`. (The space-header `text-xs` at `:207` is a 12px section label — **leave it**.)

**Fix:** Replace `text-sm` on the page-row container `<div>` with the density triplet. Apply the same triplet to the inline-rename `<input>` so the rename field matches the row it replaces. Do **not** touch `text-xs`, icon `h-4 w-4`, or any height/padding.

**Files:**
- Modify: `src/components/sidebar/virtualized-page-tree.tsx`
- Create: `tests/components/sidebar-density-page-rows.test.tsx`

Steps:

- [ ] Write a failing jsdom component test `tests/components/sidebar-density-page-rows.test.tsx`. Mirror the mount harness from `tests/components/sidebar-compact-rows.test.tsx` (jsdom has no layout, so `@tanstack/react-virtual` needs the `offsetHeight`/`offsetWidth`/`ResizeObserver` shims) and assert the rendered page-row container carries the density utilities and no longer carries `text-sm`:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
  import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
  import { I18nProvider } from '@/lib/i18n/provider';
  import enMessages from '../../messages/en.json' with { type: 'json' };

  vi.mock('next/navigation', () => ({
    usePathname: () => '/',
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  }));

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains?.('overflow-y-auto') ? 600 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains?.('overflow-y-auto') ? 240 : 0;
      },
    });
    if (typeof globalThis.ResizeObserver === 'undefined') {
      class NoopResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
        NoopResizeObserver;
    }
  });

  afterEach(cleanup);

  const node = (id: string, title: string) => ({
    id,
    title,
    icon: null,
    depth: 0,
    parentId: null,
    spaceId: null,
    status: 'published' as const,
    position: 0,
  });

  describe('sidebar page-row density (#130)', () => {
    it('renders page-title rows at the 13px density token, not text-sm', () => {
      render(
        <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
          <VirtualizedPageTree initial={[node('p1', 'Alpha')]} />
        </I18nProvider>,
      );
      const row = screen.getByText('Alpha').closest('[data-row-kind="page"]')?.querySelector('div');
      expect(row?.className).toContain('text-[length:var(--cairn-sidebar-text)]');
      expect(row?.className).toContain('leading-[var(--cairn-sidebar-leading)]');
      expect(row?.className).toContain('tracking-[0.1px]');
      expect(row?.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-page-rows.test.tsx` (fails — row still `text-sm`).
- [ ] Minimal impl in `src/components/sidebar/virtualized-page-tree.tsx`. On the page-row container `<div>` (the one with `className="group relative flex items-center gap-1.5 rounded pr-1 text-sm hover:bg-accent focus-within:bg-accent"`), replace `text-sm` with `text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px]`. In the rename `<input>` (`className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring"`), replace `text-sm` with the same triplet. Leave the space-header `text-xs`, all icon sizes, and all padding/height untouched.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-page-rows.test.tsx`.
- [ ] Manual verification (note in commit body): `source ~/.zshenv && pnpm dev`, open the workspace sidebar, confirm PAGES tree titles render visibly smaller/tighter than before while the section labels stay the same size.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(sidebar): apply 13px density token to PAGES tree rows (#130)"`

---

## C3 — Apply density token to saved-search rows (#130)

**Cause:** `src/components/sidebar/saved-searches.tsx:96` sets each saved-search `<li>` to `text-sm`; the rename `<input>` (`:115`) is `text-sm`. The section heading (`:88`, `text-xs`) is a 12px label — **leave it**. The row's icon buttons are `h-11 w-11` (44px) — **leave them**.

**Fix:** Swap `text-sm` for the density triplet on the `<li>` row and the rename `<input>`. No height/icon-button changes.

**Files:**
- Modify: `src/components/sidebar/saved-searches.tsx`
- Create: `tests/components/sidebar-density-saved-searches.test.tsx`

Steps:

- [ ] Write a failing jsdom test `tests/components/sidebar-density-saved-searches.test.tsx`. `SavedSearches` fetches `/api/search/saved` on mount and renders `null` when empty, so stub `fetch` to return one saved search, stub `useT`/`mutation-bus`/`confirm-dialog`, and assert the row carries the density utilities:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen, waitFor } from '@testing-library/react';
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  import { SavedSearches } from '@/components/sidebar/saved-searches';

  vi.mock('@/lib/i18n/provider', async () => {
    const en = (await import('@/../messages/en.json')).default as Record<string, string>;
    return { useT: () => (key: string) => en[key] ?? key };
  });
  vi.mock('@/lib/client/mutation-bus', () => ({ subscribeMutation: () => () => {} }));
  vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          savedSearches: [{ id: 's1', name: 'Open bugs', query: 'is:open', filters: {} }],
        }),
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  describe('saved-search row density (#130)', () => {
    it('renders saved-search rows at the 13px density token, not text-sm', async () => {
      render(<SavedSearches />);
      await waitFor(() => screen.getByText('Open bugs'));
      const li = screen.getByText('Open bugs').closest('li');
      expect(li?.className).toContain('text-[length:var(--cairn-sidebar-text)]');
      expect(li?.className).toContain('leading-[var(--cairn-sidebar-leading)]');
      expect(li?.className).toContain('tracking-[0.1px]');
      expect(li?.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-saved-searches.test.tsx`.
- [ ] Minimal impl in `src/components/sidebar/saved-searches.tsx`. On the `<li>` (`className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent"`), replace `text-sm` with `text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px]`. On the rename `<input>` (`className="min-h-11 flex-1 rounded border bg-background px-2 text-sm"`), replace `text-sm` with the same triplet — **keep `min-h-11`**. Leave the `text-xs` heading and all `h-11 w-11` buttons untouched.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-saved-searches.test.tsx`.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(sidebar): apply 13px density token to saved-search rows (#130)"`

---

## C4 — Apply density token to footer-nav links + Sign out (#130)

**Cause:** `src/components/sidebar-footer-nav.tsx:20-21` defines `NAV_ITEM_CLASS` with both `min-h-11` (44px touch floor) and `text-sm` — used by all six utility links (Favorites/Inbox/My tasks/Templates/Settings/Trash). The "Sign out" `<Button size="sm">` (`:62-67`) inherits the button's own `text-sm` from `ui/button.tsx` but also has `min-h-11`. We want the body text at 13px while the 44px height stays.

**Fix:** In `NAV_ITEM_CLASS` replace **only** `text-sm` with the density triplet — **keep `min-h-11`**. On the Sign-out `<Button>` add the density triplet to its `className` (the button base `text-sm` is overridden by the later, more-specific arbitrary `text-[length:…]`; keep `min-h-11`). Do **not** change the version-link footer (`text-xs`, `:74-83`) or the theme toggle.

**Files:**
- Modify: `src/components/sidebar-footer-nav.tsx`
- Create: `tests/components/sidebar-footer-nav-density.test.tsx`

Steps:

- [ ] Write a failing jsdom test `tests/components/sidebar-footer-nav-density.test.tsx`. Reuse the mock set from the existing `tests/components/sidebar-footer-nav.test.tsx` (mock `review-due-counter`, `theme-toggle`, `sign-out-action`, `useT`) and assert the nav links carry the density triplet + `min-h-11` and dropped `text-sm`:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

  vi.mock('@/components/sidebar/review-due-counter', () => ({ ReviewDueCounter: () => null }));
  vi.mock('@/components/sidebar/study-link', () => ({ StudyLink: () => null }));
  vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
  vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));
  vi.mock('@/lib/i18n/provider', async () => {
    const en = (await import('@/../messages/en.json')).default as Record<string, string>;
    return { useT: () => (key: string) => en[key] ?? key };
  });

  afterEach(cleanup);

  describe('footer-nav density (#130)', () => {
    it('renders utility links at 13px density token while keeping the 44px touch floor', () => {
      render(<SidebarFooterNav version="0.9.11" />);
      const favorites = screen.getByRole('link', { name: 'Favorites' });
      expect(favorites.className).toContain('text-[length:var(--cairn-sidebar-text)]');
      expect(favorites.className).toContain('leading-[var(--cairn-sidebar-leading)]');
      expect(favorites.className).toContain('tracking-[0.1px]');
      expect(favorites.className).toContain('min-h-11'); // a11y floor intact
      expect(favorites.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    });

    it('renders Sign out at the density token while keeping min-h-11', () => {
      render(<SidebarFooterNav version="0.9.11" />);
      const signOut = screen.getByRole('button', { name: /sign out/i });
      expect(signOut.className).toContain('text-[length:var(--cairn-sidebar-text)]');
      expect(signOut.className).toContain('min-h-11'); // a11y floor intact
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav-density.test.tsx`.
- [ ] Minimal impl in `src/components/sidebar-footer-nav.tsx`:
  - In `NAV_ITEM_CLASS`, replace `text-sm` with `text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px]`. Keep `min-h-11` and every other token:
    ```tsx
    const NAV_ITEM_CLASS =
      'flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    ```
  - On the Sign-out `<Button>`, append the density triplet to its `className` (was `"min-h-11 w-full justify-start gap-2 text-muted-foreground"`):
    ```tsx
    className="min-h-11 w-full justify-start gap-2 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground"
    ```
  - Do **not** touch the version link (`text-xs`) or the `<div className="... text-sm text-muted-foreground">` wrapper at `:26` (it is a non-text container default that the per-element triplets now override on the actual text rows; leaving it avoids changing the theme-toggle row sizing).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav-density.test.tsx`.
- [ ] Regression check the existing footer-nav suite still passes: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav.test.tsx`.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(sidebar): apply 13px density token to footer nav + sign out, keep min-h-11 (#130)"`

---

## C5 — Apply density token to workspace switcher trigger (#130)

**Cause:** `src/components/workspace-switcher.tsx:52` sets the `DropdownMenu.Trigger` (the visible "Homelab"/active-workspace name row) to `text-sm` with `min-h-11`. The dropdown *menu items* (`ITEM_CLASS`, `:16-17`) are also `text-sm` + `min-h-11`, but those are the popover list, not the always-visible sidebar trigger — scope says apply to the trigger ("Homelab" text). Keep the menu items as-is to avoid widening scope; the popover is not part of the at-rest sidebar density.

**Fix:** On the `DropdownMenu.Trigger` only, replace `text-sm` with the density triplet — **keep `min-h-11`**. Leave `ITEM_CLASS`, the avatar `h-5 w-5`, and the `text-[0.65rem]` initials untouched.

**Files:**
- Modify: `src/components/workspace-switcher.tsx`
- Create: `tests/components/workspace-switcher-density.test.tsx`

Steps:

- [ ] Write a failing jsdom test `tests/components/workspace-switcher-density.test.tsx`. Mock `next/navigation` + `useT`, render with one workspace, and assert the trigger button carries the triplet + `min-h-11` and dropped `text-sm`:
  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { WorkspaceSwitcher } from '@/components/workspace-switcher';

  vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
  vi.mock('@/lib/i18n/provider', async () => {
    const en = (await import('@/../messages/en.json')).default as Record<string, string>;
    return { useT: () => (key: string) => en[key] ?? key };
  });

  afterEach(cleanup);

  describe('workspace-switcher trigger density (#130)', () => {
    it('renders the active-workspace trigger at 13px density token, keeping min-h-11', () => {
      render(
        <WorkspaceSwitcher
          workspaces={[{ id: 'w1', name: 'Homelab', role: 'owner' }]}
          activeId="w1"
        />,
      );
      const trigger = screen.getByText('Homelab').closest('button');
      expect(trigger?.className).toContain('text-[length:var(--cairn-sidebar-text)]');
      expect(trigger?.className).toContain('leading-[var(--cairn-sidebar-leading)]');
      expect(trigger?.className).toContain('tracking-[0.1px]');
      expect(trigger?.className).toContain('min-h-11'); // a11y floor intact
      expect(trigger?.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-density.test.tsx`.
- [ ] Minimal impl in `src/components/workspace-switcher.tsx`: on the `DropdownMenu.Trigger` `className` (was `"flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm font-medium hover:bg-accent"`), replace `text-sm` with `text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px]`. Keep `min-h-11`, `font-medium`, and everything else. Do **not** touch `ITEM_CLASS`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/workspace-switcher-density.test.tsx`.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(sidebar): apply 13px density token to workspace switcher trigger (#130)"`

---

## C6 — Drop sidebar default width 256→224 (#131)

**Cause:** `src/components/sidebar.tsx:26` is `style={{ width: 'var(--cairn-sidebar-w, 16rem)' }}`. `16rem` = 256px. The width is otherwise user-resizable + persisted via `SidebarResizeHandle` (`storageKey="cairn:sidebar-width"`), which sets `--cairn-sidebar-w` from localStorage on the client. Only the **fallback** (used pre-hydration and for users who never dragged) needs to be 224px = `14rem`.

**Fix:** Change the fallback `16rem`→`14rem`. The `<aside>` is non-interactive, so this has no touch-target impact. Update the adjacent comment that says "falling back to 16rem (= the old w-64)".

**Files:**
- Modify: `src/components/sidebar.tsx`
- Create: `tests/components/sidebar-default-width.test.tsx`

Steps:

- [ ] Write a failing test `tests/components/sidebar-default-width.test.tsx`. `Sidebar` is an async server component, so assert against the CSS-source fallback rather than rendering it (mirrors how `sidebar-shell.test.tsx` asserts `SIDEBAR_ASIDE_CLASS` without rendering):
  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const src = readFileSync(join(process.cwd(), 'src/components/sidebar.tsx'), 'utf8');

  describe('sidebar default width (#131)', () => {
    it('falls back to 14rem (224px), not 16rem', () => {
      expect(src).toContain("var(--cairn-sidebar-w, 14rem)");
      expect(src).not.toContain('var(--cairn-sidebar-w, 16rem)');
    });
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-default-width.test.tsx`.
- [ ] Minimal impl in `src/components/sidebar.tsx`: change `style={{ width: 'var(--cairn-sidebar-w, 16rem)' }}` to `style={{ width: 'var(--cairn-sidebar-w, 14rem)' }}`, and update the comment block above the `<aside>` so "falling back to 16rem (= the old w-64)" reads "falling back to 14rem (= 224px, #131; was 16rem/256) before hydration". Do not touch `SidebarResizeHandle` or its storage key — persisted widths must still win.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-default-width.test.tsx`.
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(sidebar): default width 256->224 (fallback 16rem->14rem), keep resize persistence (#131)"`

---

## C7 — Trim palette-trigger padding `py-2`→`py-1.5`, keep min-h-11 (#132)

**Cause:** `src/components/search-hint-button.tsx:26` is `mb-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-2 text-sm text-muted-foreground hover:bg-accent`. The `py-2` adds internal padding on top of `min-h-11`; reducing to `py-1.5` tightens the visual block. The button stays ≥44px because **`min-h-11` is retained**.

**Fix:** Change `py-2`→`py-1.5`. Keep `min-h-11`. (Leave `text-sm` here — this is the palette trigger label, not one of the five #130 body surfaces enumerated in scope; the issue #132 ask is the padding trim only.)

**Files:**
- Modify: `src/components/search-hint-button.tsx`
- Modify: `tests/components/search-hint-button.test.tsx` (extend existing suite)

Steps:

- [ ] Add a failing assertion to the existing `tests/components/search-hint-button.test.tsx` (the suite already mocks `useT` and asserts `min-h-11`):
  ```tsx
  it('trims internal padding to py-1.5 while keeping the 44px touch floor (#132)', () => {
    render(<SearchHintButton />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('py-1.5');
    expect(btn.className).not.toMatch(/(^|\s)py-2(\s|$)/);
    expect(btn.className).toContain('min-h-11'); // a11y floor intact
  });
  ```
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/search-hint-button.test.tsx` (new case fails — still `py-2`).
- [ ] Minimal impl in `src/components/search-hint-button.tsx`: in the button `className`, change `py-2` to `py-1.5`. Keep `min-h-11`, `px-2`, and everything else.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/search-hint-button.test.tsx` (all cases, including the pre-existing `min-h-11` assertion at the existing line, pass).
- [ ] Commit: `source ~/.zshenv && git add -A && git commit -m "feat(sidebar): trim palette trigger padding py-2->py-1.5, keep min-h-11 (#132)"`

---

## C8 — Full verification gate (a11y MUST stay green)

**Cause:** Every change above is font/leading/tracking/width/padding only, with `min-h-11` retained on all interactive elements and no new i18n strings. The gate proves the density change cost nothing — Biome clean, types intact, full unit suite green, build succeeds, and **the e2e touch-target a11y gate stays green** (the safety net for "font-only, no box shrank").

**Fix:** Run the full gate. The a11y e2e is the decisive check: it asserts every visible interactive element is ≥44×44. Because no interactive height changed (all `min-h-11` kept), it must remain green; if it fails, an interactive height regressed and must be reverted, not the spec relaxed.

**Files:** none (verification only).

Steps:

- [ ] Lint (0 errors required): `source ~/.zshenv && pnpm lint`. If Biome reports import-order/line-reflow fixes, apply them: `source ~/.zshenv && pnpm biome check --write . && git add -A && git commit -m "chore: biome autofix (plan C)"`.
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck`.
- [ ] i18n audit — confirm **no new strings** were introduced (token/className change only): `source ~/.zshenv && pnpm i18n:check`.
- [ ] Full unit suite (Docker/Colima must be running for Testcontainers): `source ~/.zshenv && pnpm test`.
- [ ] Build: `source ~/.zshenv && pnpm build`.
- [ ] **A11y e2e gate (the safety net):** `source ~/.zshenv && pnpm test:a11y`. MUST be green. This runs `tests/a11y/mobile-touch-targets.spec.ts`, which fails on any interactive element under 44×44. Since every interactive surface kept `min-h-11`, the font-size reduction cannot shrink a box below 44px and this gate stays green. **If it fails, a `min-h-11` was accidentally dropped — restore it; do not weaken the spec.**
- [ ] HOLD: do not push and do not open/merge the PR. Report gate results to the controller and await GO. (This plan is part of the single v0.9.11 PR onto `patches/v0.9.11`.)
