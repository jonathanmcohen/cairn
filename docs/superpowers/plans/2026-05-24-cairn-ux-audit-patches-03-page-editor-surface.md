# P03 — Page Editor Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** De-duplicate the "Add cover" affordances, consolidate the two competing top-right control clusters, make the content column intentional, fix the empty-database header rendering, scale callout headings, and give the editor top tab strip separators + active state.

**Architecture:** Changes concentrate in `src/app/(app)/pages/[pageId]/page.tsx`, `src/components/pages/*`, `src/components/editor/editor.tsx` + `suggestion-toolbar.tsx`, `src/components/databases/database-block.tsx`, and callout CSS in `src/components/editor/code-highlight.css`.

**Tech Stack:** React 19 RSC + TipTap 3, Tailwind v4 typography plugin.

**Covers:** GH #16 (a7 dup cover), #17 (a8 dup control box), #18 (a9 whitespace/column), #19 (a10 empty DB header), #20 (a11 callout headings), #39 (a30 tab strip).

---

### Task 1: Single "Add cover" affordance (#16)

**Files:**
- Modify: `src/app/(app)/pages/[pageId]/page.tsx` (floating CoverPicker ~L68-71)
- Modify/keep: `src/components/cover-image.tsx` ("+ Add cover" ~L43), `src/components/pages/cover-picker.tsx`

- [ ] **Step 1: Pick the canonical affordance, remove the duplicate**

Decide: the cover affordance belongs **above the title** (the `CoverImage` empty-state button at `cover-image.tsx` ~L43 is the natural in-flow location). Remove the **floating** `CoverPicker` mount in `page.tsx` (~L68-71) when there is no cover, OR keep the floating `CoverPicker` as the single control and remove the `CoverImage` "+ Add cover" button — but NOT both. Recommended: keep the in-flow `CoverImage` button (it sits where the cover will appear), remove the floating duplicate.

Read both render sites first; ensure the kept path still opens `CoverPicker` (the modal) and that "Change cover" (when a cover exists) still works.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. In `pnpm dev`, a page with no cover shows exactly one "Add cover" control; setting a cover shows one "Change" control.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/pages/[pageId]/page.tsx" src/components/cover-image.tsx
git commit -m "fix(editor): single Add cover affordance — Closes #16"
```

---

### Task 2: Consolidate top-right control clusters (#17)

**Files:**
- Modify: `src/app/(app)/pages/[pageId]/page.tsx` (title-row cluster ~L74-104)
- Modify: `src/components/pages/page-mode-toggles.tsx` (Focus/Reader floating ~L17-47), `src/components/pages/page-mode-shell.tsx` (toggles slot ~L150)

- [ ] **Step 1: Merge Focus/Reader toggles into the title-row action bar**

The floating box (Focus=Maximize2, Reader=Eye) and the title-row cluster (comments / history / Export / lock / ⋮) read as two competing toolbars. Move the `PageModeToggles` buttons into the same flex action bar as the title-row icons so there is one coherent control group. Keep the focus/reader STATE logic in `PageModeShell`; only relocate where the toggle buttons render — pass them into the title-row cluster (e.g. render `<PageModeToggles/>` as the leading items of the title-row `<div>` in `page.tsx` instead of via the floating shell slot).

If `PageModeShell` must own the toggles for the focus-mode class toggle to work, instead style both groups into a single visually-unified bar (same container, same button variant, a thin separator between mode toggles and page actions) so they no longer look like two boxes.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. In `pnpm dev`, confirm one action bar; Focus + Reader still toggle.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/pages/[pageId]/page.tsx" src/components/pages/page-mode-toggles.tsx src/components/pages/page-mode-shell.tsx
git commit -m "fix(editor): consolidate page mode toggles into the title action bar — Closes #17"
```

---

### Task 3: Make the content column intentional (#18)

**Files:**
- Modify: `src/components/pages/page-detail-shell.tsx` (`max-w-3xl` wrapper ~L17)

- [ ] **Step 1: Center the column and signal it deliberately**

The `max-w-3xl` column already exists; the void to the right reads as accidental. Ensure the column is horizontally centered (`mx-auto`) — confirm it is — and add breathing room + a subtle treatment so the page area reads intentionally (e.g. consistent vertical padding, and let the page background/cover fill the full width while the text column stays centered). If covers/backgrounds span full width while text is centered, the right whitespace becomes obviously part of the reading column rather than empty void.

Concretely: keep `mx-auto w-full max-w-3xl`, add responsive horizontal padding (`px-4 sm:px-6 lg:px-8`), and ensure the parent page region has `min-h-dvh` background fill so there is no bare void.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. Visual check at wide viewport: centered column, no jarring empty void.

- [ ] **Step 3: Commit**

```bash
git add src/components/pages/page-detail-shell.tsx
git commit -m "polish(editor): intentional centered content column + page padding — Closes #18"
```

---

### Task 4: Empty database block header row (#19)

**Files:**
- Modify: `src/components/databases/database-block.tsx` (~L42-66) and/or the table view component
- Test: `tests/components/databases/empty-db-header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
// Import the view/block component that renders an empty database table.
// Use the smallest component that owns the header-row render (read the file to choose).
import { DatabaseTableView } from '@/components/databases/table-view';

afterEach(cleanup);

describe('empty database rendering', () => {
  it('renders column header(s) even when there are zero rows', () => {
    render(
      <DatabaseTableView
        rows={[]}
        properties={[{ id: 'name', name: 'Name', type: 'text' }] as never}
        {/* supply the minimal real props the component needs */}
      />,
    );
    expect(screen.getByText('Name')).toBeTruthy();
  });
});
```

The implementer reads `table-view.tsx` to get the real prop names/types and the correct component that should render the header. The test asserts that a property’s column header renders with zero rows.

- [ ] **Step 2: Run it, confirm it fails or reveals the gap**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/empty-db-header.test.tsx`
Expected: FAIL — header not rendered when `rows=[]` (the bug), or the component short-circuits to an empty state without headers.

- [ ] **Step 3: Render the header row regardless of row count**

In the table view (and the empty-state branch of `database-block.tsx`), ensure the column header row renders whenever there is at least one property, independent of `rows.length`. If the component currently returns early on empty rows before the `<thead>`/header markup, restructure so the header always renders and only the body shows an empty hint ("No rows yet — add one with + New row").

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/empty-db-header.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/databases/table-view.tsx src/components/databases/database-block.tsx tests/components/databases/empty-db-header.test.tsx
git commit -m "fix(databases): render header row for empty database block — Closes #19"
```

---

### Task 5: Scale headings inside callouts (#20)

**Files:**
- Modify: `src/components/editor/code-highlight.css` (`.callout` rules ~L41-68) — add callout-scoped heading overrides
- Reference: typography via `src/app/globals.css`

- [ ] **Step 1: Add callout-scoped heading typography**

Append callout heading overrides so nested headings are smaller than page headings:

```css
/* Callout-scoped heading scale — keep hierarchy inside the box */
.callout :is(h1, h2, h3, h4, h5, h6) {
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
  line-height: 1.3;
}
.callout h1 { font-size: 1.125rem; font-weight: 600; }
.callout h2 { font-size: 1.0625rem; font-weight: 600; }
.callout h3 { font-size: 1rem; font-weight: 600; }
.callout :is(h4, h5, h6) { font-size: 0.9375rem; font-weight: 600; }
```

Confirm the callout node’s rendered DOM carries the `.callout` class (it does per `callout-extension.ts` → `.callout*` CSS). If the editor body is inside a `.prose` container, increase specificity as needed (e.g. `.prose .callout h1`) so these win over the typography plugin defaults.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm build`
Expected: clean. In `pnpm dev`, insert a callout with an H1/H2 inside; confirm headings are visibly smaller than page headings but still bold.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/code-highlight.css
git commit -m "fix(editor): scale headings inside callouts — Closes #20"
```

---

### Task 6: Editor top tab strip — separators + active state (#39)

**Files:**
- Modify: `src/components/editor/editor.tsx` (top control bar ~L466-490)
- Modify: `src/components/editor/suggestion-toolbar.tsx` (Suggest edits / N open)

- [ ] **Step 1: Add separators + clear active/toggle states**

The four controls (Suggest edits, N open, Live/status, Outline) render as bare labels in one flex row. Give the bar structure:
- Wrap in a container with `divide-x` or insert thin `<span className="h-4 w-px bg-border" aria-hidden />` separators between logical groups.
- "Suggest edits" toggle: when active, use the primary/filled button variant + `aria-pressed={suggesting}`.
- "Outline" toggle: filled/active when `outlineOpen`, `aria-pressed={outlineOpen}`.
- "Live" status: render as a status pill with a colored dot, not a bare word.
- "N open": render as a muted count chip.

Keep all existing handlers/state; this is presentation only. Use the real state variable names from the file (`outlineOpen`, the suggestion-mode flag, the status string).

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. In `pnpm dev`, confirm the strip reads as distinct controls with visible separators and active states; toggles reflect state.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/editor.tsx src/components/editor/suggestion-toolbar.tsx
git commit -m "polish(editor): separators + active state for the top control strip — Closes #39"
```

---

## Self-Review

- Covers #16,#17,#18,#19,#20,#39. ✓
- #19 is TDD'd (header-render logic); #16/#17/#18/#20/#39 are markup/CSS with build + visual verification. ✓
- Decisions (which cover affordance to keep; whether toggles move vs unify) stated with a recommended default, implementer confirms by reading the files. ✓
- No undefined types: tests instruct the implementer to read real prop shapes before writing assertions. ✓
