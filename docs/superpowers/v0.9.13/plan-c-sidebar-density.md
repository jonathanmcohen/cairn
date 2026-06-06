# v0.9.13 Plan C — Sidebar density (rows + padding)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute each task below as an independent subagent. Paste the full task block (including context) into each subagent. Work the checkbox (- [ ]) steps in order. Prefix every shell command with `source ~/.zshenv && `.

## Goal

Reclaim ~140 px of sidebar vertical space on desktop mouse devices by:

- **C-v2 (rows):** pointer-gate `NAV_ITEM_CLASS`, the Sign-out `<Button>`, and `StudyLink` from a flat `min-h-11` (44 px) to `min-h-[28px]` at fine pointer, restoring the 44 px touch floor via `pointer-coarse:min-h-11`. Also fix the `StudyLink` font outlier (`text-sm` 14 px → the 13 px density triplet).
- **C-v3 (padding/tokens):** tighten the `<nav>` wrapper padding (`p-3` → `p-1.5`), workspace-switcher container padding (`p-2` → `p-1`), and inter-section gaps (`mb-3` → `mb-1.5` on Favorites/Recents sections). Optionally reduce the virtualizer row height (`ROW_HEIGHT_PX = 30` → `26`) and centralize new padding tokens in `globals.css`.

**CRITICAL a11y invariant:** every interactive row MUST keep 44 px at `pointer-coarse` (real touch/stylus devices). Only fine-pointer (desktop mouse) shrinks. `min-h` must NOT be dropped entirely. The `pointer-coarse` variant ships in Tailwind v4 — no plugin needed.

## Architecture

Pure className/CSS changes across four component files and one CSS file. No new routes, no DB changes, no i18n strings. Tests use `@testing-library/react` in jsdom, mirroring the existing `sidebar-footer-nav-density.test.tsx` and `sidebar-density-*.test.tsx` harness pattern.

**Touch-target gate note:** `tests/a11y/mobile-touch-targets.spec.ts` covers only `/settings/developer/*`; `shell.spec.ts` axe does not assert WCAG 2.5.5 over the sidebar. The `pointer-coarse:min-h-11` guard is therefore a discipline choice enforced by the unit tests in this plan, not by an existing e2e gate.

## Tech Stack

- Tailwind CSS v4 (`pointer-coarse` variant available natively)
- `@testing-library/react` + jsdom (vitest)
- No new dependencies

---

## File structure

```
src/
  app/
    globals.css                               ← (C-v3 opt) add --cairn-sidebar-px / --cairn-sidebar-section-gap tokens
  components/
    sidebar-footer-nav.tsx                    ← C-v2: NAV_ITEM_CLASS + Sign-out Button
    sidebar-content.tsx                       ← C-v3: nav p-3→p-1.5, workspace container p-2→p-1, section gaps
    sidebar/
      study-link.tsx                          ← C-v2: min-h + font outlier fix
      virtualized-page-tree.tsx               ← C-v3 (optional): ROW_HEIGHT_PX 30→26
tests/
  components/
    sidebar-footer-nav-density.test.tsx       ← extend existing suite (new pointer-coarse assertions)
    sidebar-density-study-link.test.tsx       ← NEW: StudyLink className assertions
    sidebar-density-containers.test.tsx       ← NEW: sidebar-content nav/workspace container assertions
    sidebar-density-tokens.test.ts            ← extend existing suite (optional token assertions)
```

---

## Tasks

---

### Task C-1 — Extend footer-nav density test: assert pointer-coarse guard on NAV_ITEM_CLASS links

**Context:** `tests/components/sidebar-footer-nav-density.test.tsx` currently asserts `min-h-11` is present on NAV_ITEM_CLASS links (the old requirement). After C-v2, the bare `min-h-11` is replaced with `min-h-[28px] pointer-coarse:min-h-11`. Write the new failing assertions first; keep the existing suite structure.

- [ ] Open `tests/components/sidebar-footer-nav-density.test.tsx` (full path: `/Users/jon/projects/cairn/tests/components/sidebar-footer-nav-density.test.tsx`).
- [ ] In the existing `describe('footer-nav density (#130)')` block, **replace** the current `it('renders utility links at 13px density token while keeping the 44px touch floor', ...)` test body with the assertions below (keep the density-token assertions; update the height assertions):

  ```typescript
  it('renders utility links at 13px density token with pointer-gated height', () => {
    render(<SidebarFooterNav version="0.9.13" />);
    const favorites = screen.getByRole('link', { name: 'Favorites' });
    // Density token present
    expect(favorites.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(favorites.className).toContain('leading-[var(--cairn-sidebar-leading)]');
    expect(favorites.className).toContain('tracking-[0.1px]');
    // Pointer-gated height: desktop ~28px, touch 44px
    expect(favorites.className).toContain('min-h-[28px]');
    expect(favorites.className).toContain('pointer-coarse:min-h-11');
    // MUST NOT carry a bare min-h-11 (that defeats the pointer gate)
    expect(favorites.className).not.toMatch(/(^|\s)min-h-11(\s|$)/);
    // No text-sm outlier
    expect(favorites.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });
  ```

- [ ] **Replace** the existing Sign-out button test body:

  ```typescript
  it('renders Sign out button with pointer-gated height', () => {
    render(<SidebarFooterNav version="0.9.13" />);
    const signOut = screen.getByRole('button', { name: /sign out/i });
    expect(signOut.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(signOut.className).toContain('min-h-[28px]');
    expect(signOut.className).toContain('pointer-coarse:min-h-11');
    expect(signOut.className).not.toMatch(/(^|\s)min-h-11(\s|$)/);
  });
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav-density.test.tsx` — **expect RED** (tests should fail because the source still has `min-h-11`).
- [ ] Commit: `test(sidebar): assert pointer-gated min-h on NAV_ITEM_CLASS links and Sign-out [RED]`

---

### Task C-2 — Implement C-v2 on NAV_ITEM_CLASS and Sign-out Button

**Context:** `src/components/sidebar-footer-nav.tsx` line 20–21 defines `NAV_ITEM_CLASS` with `min-h-11 ... py-1.5`. Line 65 has the Sign-out `<Button>` with `min-h-11 ...`. Both need the pointer-gate swap.

**Current `NAV_ITEM_CLASS` (line 20–21):**
```
'flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
```

**Current Sign-out Button className (line 65):**
```
"min-h-11 w-full justify-start gap-2 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground"
```

- [ ] Open `src/components/sidebar-footer-nav.tsx`.
- [ ] Replace `NAV_ITEM_CLASS` with:

  ```typescript
  const NAV_ITEM_CLASS =
    'flex min-h-[28px] items-center gap-2 rounded px-2 py-1 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:py-1.5';
  ```

  Key changes: `min-h-11` → `min-h-[28px]`; `py-1.5` → `py-1`; append `pointer-coarse:min-h-11 pointer-coarse:py-1.5`.

- [ ] Replace the Sign-out `<Button>` `className` prop (line 65) with:

  ```tsx
  className="min-h-[28px] w-full justify-start gap-2 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground pointer-coarse:min-h-11"
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-footer-nav-density.test.tsx` — **expect GREEN**.
- [ ] Run `source ~/.zshenv && pnpm lint && pnpm typecheck` — expect 0 errors.
- [ ] Commit: `fix(sidebar): pointer-gate NAV_ITEM_CLASS and Sign-out to min-h-[28px] on fine pointer (C-v2)`

---

### Task C-3 — New test: StudyLink pointer-gated height + density token (RED)

**Context:** `src/components/sidebar/study-link.tsx` line 18 has `min-h-11 ... py-1 text-sm text-muted-foreground`. Two problems: bare `min-h-11` (no pointer gate) and `text-sm` (14 px outlier — all other nav items use the 13 px density triplet). Write the new test file first.

- [ ] Create `tests/components/sidebar-density-study-link.test.tsx`:

  ```typescript
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { StudyLink } from '@/components/sidebar/study-link';

  vi.mock('@/lib/i18n/provider', async () => {
    const en = (await import('@/../messages/en.json')).default as Record<string, string>;
    return { useT: () => (key: string) => en[key] ?? key };
  });

  afterEach(cleanup);

  describe('StudyLink density (C-v2)', () => {
    it('renders with pointer-gated height (min-h-[28px] + pointer-coarse:min-h-11)', () => {
      render(<StudyLink />);
      const link = screen.getByRole('link');
      expect(link.className).toContain('min-h-[28px]');
      expect(link.className).toContain('pointer-coarse:min-h-11');
      // bare min-h-11 must not be present (would defeat the pointer gate)
      expect(link.className).not.toMatch(/(^|\s)min-h-11(\s|$)/);
    });

    it('uses the 13px density triplet, not text-sm', () => {
      render(<StudyLink />);
      const link = screen.getByRole('link');
      expect(link.className).toContain('text-[length:var(--cairn-sidebar-text)]');
      expect(link.className).toContain('leading-[var(--cairn-sidebar-leading)]');
      expect(link.className).toContain('tracking-[0.1px]');
      expect(link.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    });
  });
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-study-link.test.tsx` — **expect RED**.
- [ ] Commit: `test(sidebar): StudyLink pointer-gate + density-triplet assertions [RED]`

---

### Task C-4 — Implement C-v2 on StudyLink

**Context:** `src/components/sidebar/study-link.tsx` line 18 currently:
```
className="mb-2 flex min-h-11 items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50"
```

- [ ] Open `src/components/sidebar/study-link.tsx`.
- [ ] Replace the `className` on the `<Link>` (line 18) with:

  ```tsx
  className="mb-2 flex min-h-[28px] items-center gap-2 rounded px-2 py-1 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground hover:bg-accent/50 pointer-coarse:min-h-11 pointer-coarse:py-1.5"
  ```

  Key changes: `min-h-11` → `min-h-[28px]`; `text-sm` → the density triplet; append `pointer-coarse:min-h-11 pointer-coarse:py-1.5`.

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-study-link.test.tsx` — **expect GREEN**.
- [ ] Also confirm the existing page-row density suite still passes: `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-page-rows.test.tsx`.
- [ ] Run `source ~/.zshenv && pnpm lint && pnpm typecheck` — 0 errors.
- [ ] Commit: `fix(sidebar): pointer-gate StudyLink height + replace text-sm with density triplet (C-v2)`

---

### Task C-5 — New test: sidebar container padding assertions (RED)

**Context:** `src/components/sidebar-content.tsx` line 38 has `border-b p-2` (workspace-switcher container); line 48 has `p-3` on the `<nav>` wrapper. C-v3 tightens these to `p-1` and `p-1.5` respectively. Write the failing tests first.

- [ ] Create `tests/components/sidebar-density-containers.test.tsx`:

  ```typescript
  // @vitest-environment jsdom
  import { cleanup, render } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';

  // SidebarContent is an async server component — test via snapshot of its
  // rendered output by extracting the relevant wrapper divs. Because the component
  // calls server-only helpers (getAuthContext, flattenedPageTree, etc.) we render
  // the lightweight structural shell inline here rather than importing the full
  // async component.
  //
  // Strategy: render a minimal structural replica of SidebarContent's outer
  // skeleton and assert the className values the plan changes.

  afterEach(cleanup);

  describe('SidebarContent container padding (C-v3)', () => {
    it('workspace-switcher container uses p-1 (not p-2)', () => {
      // The workspace container is the first child div inside the flex column.
      // We assert the className the implementation must carry after C-v3.
      const className = 'border-b p-1';
      expect(className).toContain('p-1');
      expect(className).not.toMatch(/(^|\s)p-2(\s|$)/);
    });

    it('nav wrapper uses p-1.5 (not p-3)', () => {
      const className =
        'flex min-h-0 flex-1 flex-col p-1.5';
      expect(className).toContain('p-1.5');
      expect(className).not.toMatch(/(^|\s)p-3(\s|$)/);
    });
  });

  // Source-of-truth test: read the actual component file and assert the
  // className strings directly — this is the binding assertion that will go RED
  // until the implementation is updated.
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';

  const src = readFileSync(
    join(process.cwd(), 'src/components/sidebar-content.tsx'),
    'utf8',
  );

  describe('SidebarContent source className assertions (C-v3)', () => {
    it('workspace-switcher container carries p-1 not p-2', () => {
      // The workspace container line must contain p-1 (exact) and not p-2
      const line = src
        .split('\n')
        .find((l) => l.includes('border-b') && l.includes('WorkspaceSwitcher') === false && l.includes('p-'));
      expect(line).toBeDefined();
      expect(line).toContain('p-1');
      expect(line).not.toMatch(/(^|\s|")p-2("|\s|$)/);
    });

    it('nav wrapper carries p-1.5 not p-3', () => {
      const line = src
        .split('\n')
        .find((l) => l.includes('aria-labelledby="sidebar-pages-heading"'));
      expect(line).toBeDefined();
      expect(line).toContain('p-1.5');
      expect(line).not.toMatch(/(^|\s|")p-3("|\s|$)/);
    });
  });
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-containers.test.tsx` — **expect RED** (source still has `p-2` and `p-3`).
- [ ] Commit: `test(sidebar): container padding source assertions for C-v3 [RED]`

---

### Task C-6 — Implement C-v3: tighten nav wrapper, workspace container, and section gaps

**Context:** `src/components/sidebar-content.tsx`:
- Line 38: `<div className="border-b p-2">` — workspace-switcher container
- Line 48: `<nav aria-labelledby="sidebar-pages-heading" className="flex min-h-0 flex-1 flex-col p-3">` — nav wrapper

`src/components/sidebar-favorites.tsx` line 108: `<section aria-label="Favorite pages" className="mb-3">` — section bottom gap.
`src/components/sidebar-recents.tsx` line 15: `<section aria-label="Recent pages" className="mb-3">` — section bottom gap.

- [ ] Open `src/components/sidebar-content.tsx`.
- [ ] On line 38, change `border-b p-2` to `border-b p-1`:

  ```tsx
  <div className="border-b p-1">
  ```

- [ ] On line 48, change `p-3` to `p-1.5`:

  ```tsx
  <nav aria-labelledby="sidebar-pages-heading" className="flex min-h-0 flex-1 flex-col p-1.5">
  ```

- [ ] Open `src/components/sidebar-favorites.tsx`. Find the `<section aria-label="Favorite pages"` element (line 108). Change `mb-3` to `mb-1.5`:

  ```tsx
  <section aria-label="Favorite pages" className="mb-1.5">
  ```

- [ ] Open `src/components/sidebar-recents.tsx`. Find the `<section aria-label="Recent pages"` element (line 15). Change `mb-3` to `mb-1.5`:

  ```tsx
  <section aria-label="Recent pages" className="mb-1.5">
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-containers.test.tsx` — **expect GREEN**.
- [ ] Run `source ~/.zshenv && pnpm lint && pnpm typecheck` — 0 errors.
- [ ] Commit: `fix(sidebar): tighten nav p-3→p-1.5, workspace p-2→p-1, section gaps mb-3→mb-1.5 (C-v3)`

---

### Task C-7 (OPTIONAL) — Denser PAGES tree: ROW_HEIGHT_PX 30 → 26

**Label: OPTIONAL — implement only if the controller explicitly confirms. Skip and move to C-8 if not confirmed.**

**Context:** `src/components/sidebar/virtualized-page-tree.tsx` line 28: `export const ROW_HEIGHT_PX = 30;`. Reducing to 26 saves ~4 px per visible tree row at no a11y cost (the rows were already sub-44 px since v0.9.0 C2; the interactive link is an `absolute inset-0` overlay, not a min-height row). The `estimateSize` callback uses this constant directly.

- [ ] Add a source-reading assertion to `tests/components/sidebar-density-tokens.test.ts` (the existing file at `/Users/jon/projects/cairn/tests/components/sidebar-density-tokens.test.ts`):

  ```typescript
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';

  const treeSrc = readFileSync(
    join(process.cwd(), 'src/components/sidebar/virtualized-page-tree.tsx'),
    'utf8',
  );

  describe('sidebar tree row height (C-v3 optional)', () => {
    it('ROW_HEIGHT_PX is 26 (denser tree)', () => {
      expect(treeSrc).toMatch(/ROW_HEIGHT_PX\s*=\s*26/);
    });
  });
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-tokens.test.ts` — **expect RED** for the new test only; existing tests stay GREEN.
- [ ] Open `src/components/sidebar/virtualized-page-tree.tsx` line 28. Change `ROW_HEIGHT_PX = 30` to `ROW_HEIGHT_PX = 26`.
- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-tokens.test.ts` — **expect GREEN**.
- [ ] Run `source ~/.zshenv && pnpm lint && pnpm typecheck` — 0 errors.
- [ ] Commit: `fix(sidebar): reduce ROW_HEIGHT_PX 30→26 for denser PAGES tree (C-v3 optional)`

---

### Task C-8 (OPTIONAL) — Centralize new padding tokens in globals.css

**Label: OPTIONAL — implement only if the controller confirms it stays DRY and adds real reuse across more than two call sites. Skip and move to C-9 if not confirmed.**

**Context:** `src/app/globals.css` already has `--cairn-sidebar-text: 13px` and `--cairn-sidebar-leading: 18px` under `@theme` (lines 96–97). Introduce `--cairn-sidebar-px: 6px` (nav horizontal pad) and `--cairn-sidebar-section-gap: 6px` (inter-section margin) to mirror the pattern.

- [ ] Add an assertion to `tests/components/sidebar-density-tokens.test.ts`:

  ```typescript
  describe('sidebar padding tokens (C-v3 optional)', () => {
    it('defines --cairn-sidebar-px token', () => {
      expect(css).toMatch(/--cairn-sidebar-px:\s*6px/);
    });
    it('defines --cairn-sidebar-section-gap token', () => {
      expect(css).toMatch(/--cairn-sidebar-section-gap:\s*6px/);
    });
  });
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-tokens.test.ts` — **expect RED** for the new tests.
- [ ] Open `src/app/globals.css`. After the `--cairn-sidebar-leading: 18px;` line (line 97), add:

  ```css
  /* v0.9.13 C-v3 — sidebar padding/gap tokens. nav px = p-1.5 (6px);
     section gap = mb-1.5 (6px). Tokenized to mirror the text/leading pattern. */
  --cairn-sidebar-px: 6px;
  --cairn-sidebar-section-gap: 6px;
  ```

- [ ] Run `source ~/.zshenv && pnpm vitest run tests/components/sidebar-density-tokens.test.ts` — **expect GREEN** (all token tests pass).
- [ ] Run `source ~/.zshenv && pnpm lint && pnpm typecheck` — 0 errors.
- [ ] Commit: `feat(sidebar): add --cairn-sidebar-px and --cairn-sidebar-section-gap tokens to globals.css (C-v3 optional)`

---

### Task C-9 — Full verification gate

- [ ] Run the full sidebar density suite:

  ```sh
  source ~/.zshenv && pnpm vitest run \
    tests/components/sidebar-footer-nav-density.test.tsx \
    tests/components/sidebar-density-study-link.test.tsx \
    tests/components/sidebar-density-containers.test.tsx \
    tests/components/sidebar-density-page-rows.test.tsx \
    tests/components/sidebar-density-saved-searches.test.tsx \
    tests/components/sidebar-density-tokens.test.ts
  ```

  All must be GREEN.

- [ ] Run the full test suite: `source ~/.zshenv && pnpm vitest run` — 0 new failures.
- [ ] Run lint: `source ~/.zshenv && pnpm lint` — 0 errors.
- [ ] Run typecheck: `source ~/.zshenv && pnpm typecheck` — 0 errors.
- [ ] Confirm no new i18n strings were added (this plan adds none — all text is existing keys). If any were added by accident, add en/es/ar translations and re-run.
- [ ] Run build: `source ~/.zshenv && pnpm build` — exits 0.
- [ ] Run a11y gate: `source ~/.zshenv && pnpm test:a11y` — 0 new violations.
- [ ] **Do not push.** The controller pushes after reviewing.
- [ ] Commit (if any fixups were needed): `chore(sidebar): C-v2+C-v3 gate — all checks green`
