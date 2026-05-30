# P14 — Editor Blocks & Callouts (Round 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix three new editor-block UX issues (neutral default callout, code-block "Auto" clarity, empty-toggle placeholder) and **re-fix five reopened round-1 issues** whose v0.9.3 source changes are present but did not hold in the v0.9.3 deploy. Every reopened task **must start by diagnosing why the round-1 attempt didn't resolve it in the deployed build** before re-fixing — the source already carries the round-1 edits, so a blind re-apply will reproduce the same non-result.

**Architecture:** Changes concentrate in the TipTap editor surface: callout CSS + variant default (`src/components/editor/code-highlight.css`, `callout-extension.ts`), the React node-views (`blocks/code-block-view.tsx`, `blocks/toggle-view.tsx`, `databases/table-view.tsx`), the page-detail header (`pages/[pageId]/page.tsx`, `pages/page-mode-*`), the content column (`pages/page-detail-shell.tsx`), and the editor top control strip (`editor/editor.tsx`, `editor/suggestion-toolbar.tsx`).

**Tech Stack:** React 19 RSC + TipTap 3, Tailwind v4 (CSS-first `@theme` in `src/app/globals.css`, typography plugin), `next-intl` (`messages/{en,es,ar}.json` via `t()`), Biome v2, Vitest v4.

**Covers:** GH #57, #58, #59 (new) + reopened #17, #18, #19, #20, #39.

---

## Cross-cutting constraints (apply to EVERY task)

- **Yjs-safety:** node-views (`code-block-view`, `toggle-view`, callout) may **read** node attrs and call `updateAttributes` only for explicit user actions. They must NOT write attrs (or mutate the doc) on render/mount, and placeholders/headers must be pure-presentational DOM with `contentEditable={false}` so they never enter the ProseMirror/Yjs document. The existing `code-block-view.tsx` comment (~L13-26) on "no detection write-back" is the canonical precedent — preserve that discipline.
- **i18n gate:** any **new** user-visible string must either (a) run through the `next-intl` `t()` translator with a key added to all three `messages/{en,es,ar}.json`, or (b) carry a justified `// biome-ignore i18n: <reason>` on the line above and be re-baselined (`pnpm i18n:baseline`). The editor toolbar today uses hardcoded English literals (e.g. "Suggest edits", "Outline" in `editor.tsx`) that are already baselined — match the surrounding file's existing convention per file (if the file already uses `t()`, use `t()`; if it uses literals + baseline, add the ignore + re-baseline). Run `pnpm i18n:check` before every commit that adds a string.
- **WCAG AA:** the new **neutral** callout (#57) must hold ≥4.5:1 text contrast in both light and dark themes; verify the body text token (`--foreground`) over the new neutral background. Any new interactive control keeps ≥44px touch targets (a11y CI gate).
- **Verify gate (every task):** `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test`; tasks touching rendered UI also `pnpm build`. Tasks adding strings also `pnpm i18n:check`.
- **Commit per task** with a `Closes #NN` trailer (Conventional Commits). Do NOT push.

---

## NEW ISSUES

### Task 1: Neutral default callout palette (#57)

**Problem:** The default "Note" callout uses a blue/purple-tinted background (`.callout-note { background: rgb(219 234 254 / 0.6) }` light, `rgb(30 58 138 / 0.4)` dark) that reads as a "selected" / highlighted row rather than a neutral container. The default callout should be visually quiet; saturated tints stay reserved for the *semantic* variants (tip/warning/error) and a new explicit `info`-as-blue.

**Decision:** Make the **default** callout variant neutral (slate/muted), and re-point the blue tint to the explicit `info` variant. Concretely:
- Rename the default semantics: the `callout-extension.ts` attribute default stays the same *string* if possible to avoid a doc-data migration — but its **rendered palette** becomes neutral.
- Today `info` is already slate (`.callout-info` ~L81-87) and `note` is blue. The cleanest swap that needs **no doc migration** and **no legacy-map change**: make `.callout-note` neutral (slate/muted), and give the *blue* look to `.callout-info` (already slate → repaint blue). Net effect: the default (`note`) reads neutral; users who want blue pick "Info".
- Keep tip (green), warning (amber), error (red) unchanged.

> Read `code-highlight.css` (~L41-102) and `callout-extension.ts` first to confirm the current variant↔class mapping before editing. Do NOT change the `LEGACY_COLOR_TO_VARIANT` map or the attr `default: 'note'` — old docs (`blue→note`) must keep parsing, and we are only re-skinning, not re-keying.

**Files:**
- Modify: `src/components/editor/code-highlight.css` (`.callout-note`, `.callout-info`, `.dark` variants)
- Reference: `src/components/editor/callout-extension.ts` (confirm variant default — likely no change), `src/app/globals.css` (`--muted`, `--border`, `--foreground` tokens)
- Test: `tests/components/editor/callout-palette.test.css.ts` (string-assert the CSS) OR fold into an existing callout test if one exists (read `tests/components/editor/` first).

- [ ] **Step 1: Write a guard test for the neutral default**

A jsdom render of the callout node-view is heavy (it needs the full editor); instead assert on the CSS source directly so the guard is cheap and stable. Read `tests/components/editor/` first; if a callout test file exists, add a case there, otherwise create:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(process.cwd(), 'src/components/editor/code-highlight.css'),
  'utf8',
);

describe('callout palette', () => {
  it('default note callout uses a neutral (non-blue) background', () => {
    const note = css.match(/\.callout-note\s*\{([^}]*)\}/)?.[1] ?? '';
    // neutral slate/muted, NOT the saturated blue 219 234 254 it had in round-1
    expect(note).not.toContain('219 234 254');
    expect(note).toMatch(/var\(--muted\)|241 245 249|226 232 240/);
  });

  it('info callout carries the blue accent', () => {
    const info = css.match(/\.callout-info\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(info).toMatch(/219 234 254|59 130 246/);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/callout-palette.test.css.ts`
Expected: FAIL — `.callout-note` still contains the blue `219 234 254`.

- [ ] **Step 3: Repaint the palettes**

In `code-highlight.css`:
- `.callout-note` → neutral. Prefer theme tokens for AA-safety and dark-mode parity:
  ```css
  .callout-note {
    background: hsl(var(--muted));
    border-left-color: hsl(var(--border));
  }
  .callout-note .callout-icon {
    color: hsl(var(--muted-foreground));
  }
  ```
  (This intentionally collapses the default callout onto the same neutral surface as the base `.callout` rule, which is the desired "quiet container" look. If a hairline more contrast than `.callout` is wanted, use `border-color` `--border` and a slightly elevated `--accent` background — but keep it desaturated.)
- `.callout-info` → blue (take over the old note look):
  ```css
  .callout-info {
    background: rgb(219 234 254 / 0.6);
    border-left-color: rgb(59 130 246);
  }
  .callout-info .callout-icon {
    color: rgb(59 130 246);
  }
  ```
- Dark overrides: remove/repoint `.dark .callout-note` (it set the blue `rgb(30 58 138 / 0.4)` — since `--muted` already flips in dark mode, the token-based `.callout-note` needs no dark override; **delete** the `.dark .callout-note` rule). Add the blue dark tint to `.dark .callout-info`:
  ```css
  .dark .callout-info { background: rgb(30 58 138 / 0.4); }
  ```
  (and remove the old `.dark .callout-info` slate tint).

- [ ] **Step 4: Verify AA contrast**

Confirm `--foreground` over `hsl(var(--muted))` is ≥4.5:1 in BOTH themes. Read the `--foreground`/`--muted` values in `src/app/globals.css` `@theme` (light + `.dark`) and compute the ratio (the existing base `.callout` already renders body text over `--muted`, so if that passed the v0.6 a11y sweep this is inherited-safe — note that in the commit body as the AA evidence). If `--muted` is too light/dark for AA, fall back to `--accent`/`--secondary`.

- [ ] **Step 5: Run the test + build**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/callout-palette.test.css.ts && pnpm lint && pnpm build`
Expected: PASS, clean. In `pnpm dev`: insert a default callout → reads neutral (not "selected"); the variant picker's "Info" option → blue.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/code-highlight.css tests/components/editor/callout-palette.test.css.ts
git commit -m "fix(editor): neutral default callout, blue reserved for Info — Closes #57"
```

---

### Task 2: Clarify the code-block "Auto" language label (#58)

**Problem:** The code-block language picker's "Auto" option (a `<SelectItem value="auto">` / the `LANGUAGES` entry) is ambiguous — users don't know it means automatic language detection.

**Decision:** Two complementary touches, both presentation-only and Yjs-safe (the stored attr stays `null` for auto — see the existing comment block in `code-block-view.tsx` ~L13-26, which must remain accurate):
1. Rename the visible label "Auto" → "Auto-detect" (keep the `value` as `"auto"` so the null-attr mapping at `code-block-view.tsx` L34 is unchanged).
2. Add a `title`/tooltip "Auto-detect language" on the `SelectTrigger` (or the auto item) for the long-form hint.

**Files:**
- Modify: `src/components/editor/blocks/code-block.ts` (the `LANGUAGES` array — confirm the "Auto" `label` lives here; `code-block-view.tsx` imports `LANGUAGES` from `./code-block`)
- Modify: `src/components/editor/blocks/code-block-view.tsx` (trigger `aria-label`/`title`)

- [ ] **Step 1: Diagnose where the label string lives**

Read `src/components/editor/blocks/code-block.ts` and find the `LANGUAGES` entry with `value: 'auto'`. Its `label` is the visible text. Confirm whether this label is run through `t()` anywhere or is a bare literal (it is consumed in JSX at `code-block-view.tsx` L41-43 via `{l.label}`).

- [ ] **Step 2: Rename the label + add the tooltip**

- In `code-block.ts`: change the auto entry `label` from `'Auto'` to `'Auto-detect'`. If the file already routes labels through i18n, add a key; if labels are bare literals (likely — they're language names), keep it literal and ensure `pnpm i18n:check` stays green (these data literals are already baselined or exempt — verify).
- In `code-block-view.tsx`: on the `SelectTrigger`, the `aria-label` is currently `"Code language"`. Keep it, and add a `title="Auto-detect language"` to the trigger **only when the active language is auto**, e.g.:
  ```tsx
  <SelectTrigger
    aria-label="Code language"
    title={language === 'auto' ? 'Auto-detect language' : undefined}
    className="h-9 w-36 text-xs"
  >
  ```
  These two strings ("Code language", "Auto-detect language") are pre-existing-style toolbar literals — if `i18n:check` flags the new `title`, add a `// biome-ignore i18n: editor control affordance, matches existing toolbar literals` and re-baseline, OR thread through `t()` if this file already imports a translator (read first).

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm i18n:check && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. In `pnpm dev`: the picker shows "Auto-detect"; hovering the trigger while auto shows the tooltip. Selecting it still stores a null attr (unchanged behavior).

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/blocks/code-block.ts src/components/editor/blocks/code-block-view.tsx
git commit -m "fix(editor): clarify code-block Auto language as Auto-detect — Closes #58"
```

---

### Task 3: Empty-toggle placeholder (#59)

**Problem:** A toggle block with empty content shows nothing when expanded — the open toggle looks broken/empty with no affordance to add content. `toggle-view.tsx` only renders a "Toggle (collapsed)" hint when **closed**; when open with empty children there's a bare `NodeViewContent` and no cue.

**Decision:** When the toggle is **open**, **editable**, and its content is empty, render a muted, non-editable "Empty — add content…" placeholder overlaid on/beside the content hole. It must be display-only (`contentEditable={false}`), must never write to the doc, and must disappear as soon as the user types (i.e. when content is non-empty). Viewers (`editable=false`) never see it.

> **Yjs-safety:** do not inject a placeholder *node* into the document. Use a CSS/DOM overlay or TipTap's emptiness signal. The robust approach: detect emptiness from `node.content.size` (a toggle wraps `block+`; an "empty" toggle is one empty paragraph → `node.textContent` is `''` and child count is minimal) and conditionally render a sibling `<span contentEditable={false}>`. Read the node shape first to pick the right emptiness predicate.

**Files:**
- Modify: `src/components/editor/blocks/toggle-view.tsx`
- Test: `tests/components/editor/toggle-view.test.tsx` (read `tests/components/editor/` for the existing node-view test harness pattern first — if none exists, assert via a thin render of `ToggleView` with mocked `ReactNodeViewProps`).

- [ ] **Step 1: Diagnose the emptiness signal + write the failing test**

Inspect the `node` prop shape passed to `ToggleView` (it's a ProseMirror `Node`). Determine the emptiness predicate: likely `node.textContent.trim() === '' && node.childCount <= 1`. Write a test that renders `ToggleView` with `editor.isEditable = true`, `node.attrs.open = true`, and an empty node, asserting the placeholder text is present; and a second case (non-empty node OR `isEditable=false`) asserting it is absent. Mock `NodeViewContent`/`NodeViewWrapper` if the real ones need a full editor (follow whatever pattern existing block tests use; if none, a minimal `vi.mock('@tiptap/react', ...)` returning passthrough components is acceptable).

```tsx
// @vitest-environment jsdom
// (skeleton — adapt mocks to the real harness in tests/components/editor/)
it('shows an Empty placeholder for an open editable toggle with no content', () => {
  render(<ToggleView {...propsFor({ open: true, editable: true, empty: true })} />);
  expect(screen.getByText(/Empty/i)).toBeTruthy();
});
it('hides the placeholder when content is present', () => {
  render(<ToggleView {...propsFor({ open: true, editable: true, empty: false })} />);
  expect(screen.queryByText(/Empty/i)).toBeNull();
});
it('hides the placeholder for viewers', () => {
  render(<ToggleView {...propsFor({ open: true, editable: false, empty: true })} />);
  expect(screen.queryByText(/Empty/i)).toBeNull();
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/toggle-view.test.tsx`
Expected: FAIL — no placeholder rendered.

- [ ] **Step 3: Implement the placeholder**

In `toggle-view.tsx`, compute emptiness from `node` and render the placeholder only when `open && editor.isEditable && isEmpty`. Keep it `contentEditable={false}`, muted, and positioned so it does not displace the real content hole (e.g. an absolutely-positioned hint inside the flex content area, or a sibling shown only while empty). Example shape:

```tsx
const open = node.attrs.open !== false;
const isEmpty = node.textContent.trim() === '' && node.childCount <= 1;
const showPlaceholder = open && editor.isEditable && isEmpty;
// ...
{open && (
  <div className="relative flex-1">
    <NodeViewContent className={open ? '' : 'hidden'} data-toggle-open="true" />
    {showPlaceholder && (
      <span
        contentEditable={false}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 text-sm text-muted-foreground"
      >
        {/* i18n: thread through t() if this file gains a translator; else baseline */}
        Empty — add content…
      </span>
    )}
  </div>
)}
```

Adjust the existing markup minimally — keep the collapse button, the `aria-expanded`, and the closed-state "Toggle (collapsed)" hint intact. Confirm the placeholder is `pointer-events-none` so clicks fall through to the editable content hole (so the user can click and type).

- [ ] **Step 4: i18n the new string**

"Empty — add content…" is new user-facing copy. If `toggle-view.tsx` has no translator, either add a `// biome-ignore i18n: editor empty-state hint` + re-baseline, OR (preferred if other block views already use `t()`) add `editor.toggle.emptyPlaceholder` to `messages/{en,es,ar}.json` and call `t()`. Check sibling block views for the established pattern before choosing.

- [ ] **Step 5: Run the test + verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/toggle-view.test.tsx && pnpm i18n:check && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS, clean. In `pnpm dev`: a new empty toggle, when open, shows the muted hint; typing makes it vanish; a viewer never sees it; collapsing still shows "Toggle (collapsed)".

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/blocks/toggle-view.tsx tests/components/editor/toggle-view.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(editor): empty-toggle placeholder for editors — Closes #59"
```

---

## REOPENED ISSUES (v0.9.3 fix present in source but did NOT hold in deploy)

> **Why these reopened — overarching hypothesis (verify per task):** the round-1 (P03, v0.9.3) source edits are all *present in the working tree right now* (confirmed: `page.tsx` has the consolidated toggles + separator, `page-detail-shell.tsx` has `mx-auto max-w-3xl … min-h-dvh`, `table-view.tsx` has the empty-state header branch, `code-highlight.css` has the `.prose .callout` heading scale, `editor.tsx` + `suggestion-toolbar.tsx` have the separators/chips). So the issues did NOT reopen because the code was reverted. The deploy review saw something different from the source. The most likely systemic causes — each task's Step 1 must determine which applies:
>
> 1. **Stale build artifact / image:** the v0.9.3 deploy shipped an image built before P03 merged, or a cached `.next/standalone` (note `.next/standalone/messages/en.json` exists in tree — a stale standalone bundle is a real risk). Re-fix = rebuild + redeploy, plus a guard test so a stale build is caught.
> 2. **CSS specificity / load-order lost in the production build:** Tailwind v4's production purge/ordering can drop or out-order hand-written rules in `code-highlight.css` that look "unused" to the scanner (#20 heading scale, #57 callout tints), or the typography plugin's compiled defaults win at higher specificity in prod than in dev. Re-fix = raise specificity / add to the safelist, assert via a build-output or computed-style check.
> 3. **Conditional render path not exercised in deploy data:** the fix only renders under a state the deployed instance doesn't hit (e.g. #19 empty-DB header only shows in the *non-grouped* branch; a grouped-by-default view, or `database-block.tsx` short-circuiting before `TableView`, would bypass it). Re-fix = move the guarantee up to the always-rendered path.
> 4. **Two render sites, only one patched:** #17/#18 — the page header/column is composed from multiple shells (`page.tsx`, `page-mode-shell.tsx`, `page-detail-shell.tsx`, plus the public `/p/<slug>` route which mounts a *different* shell). P03 patched the workspace route; the duplicate/whitespace persists on the path P03 didn't touch.
>
> Each reopened task below begins with a mandatory **Diagnose** step. Do not skip it; do not re-apply the round-1 edit verbatim.

---

### Task 4: Diagnose + re-fix the duplicate top-right control box (#17)

**Round-1 attempt:** P03 commit `c8f4619` — consolidated `PageModeToggles` into the title-row action bar (moved the Focus/Reader buttons out of `PageModeShell`'s floating slot into `page.tsx`, added a `h-6 w-px` separator).

**Files:**
- `src/app/(app)/pages/[pageId]/page.tsx` (~L71-106 title-row cluster)
- `src/components/pages/page-mode-shell.tsx`, `src/components/pages/page-mode-toggles.tsx`
- Suspect: `src/components/pages/page-mode-shell.tsx` may STILL render a floating toggles slot; and the public share route shell may render its own.

- [ ] **Step 1: DIAGNOSE why c8f4619 didn't hold**

Read all three files (done-state should match the round-1 edit). Then check:
- Does `PageModeShell` still mount a *second* `PageModeToggles` (or a floating control container) anywhere — i.e. is the box being rendered twice (once in `page.tsx`, once still in the shell)? Grep: `grep -rn "PageModeToggles\|page-mode-toggles\|Maximize2\|toggles slot" src/`.
- Is there a **second route** that renders a page header with its own toggles (public `/p/[slug]`, a print/export view, focus-mode overlay)? Grep for other `<PageModeToggles` / floating top-right `absolute right-` clusters in page-ish routes.
- Was the deployed image built before c8f4619 (stale artifact, hypothesis #1)? If the source is correct and singular, this is the likely cause — note it.

Write the hypothesis (1–4 above) you confirmed in the commit body.

- [ ] **Step 2: Re-fix per the confirmed cause**

- If a **second mount** exists (hypothesis #4): remove it; ensure exactly one `PageModeToggles` renders, in the title-row cluster.
- If the **public/alternate route** has a duplicate cluster: apply the same single-bar consolidation there.
- If purely a **stale build** (hypothesis #1): add a lightweight guard so regressions are caught — e.g. a test asserting `page.tsx` renders a single toggles group, and document in the commit that the durable fix is the rebuild (the P14 release task rebuilds the image).

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. `pnpm dev`: exactly one top-right control group on the workspace page route AND on the public share route; Focus + Reader still toggle.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/pages/[pageId]/page.tsx" src/components/pages/page-mode-shell.tsx src/components/pages/page-mode-toggles.tsx
git commit -m "fix(editor): single top-right control group across all page routes — Closes #17"
```

---

### Task 5: Diagnose + re-fix empty whitespace right of content (#18)

**Round-1 attempt:** P03 commit `677f033` — `page-detail-shell.tsx` got `mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8` + a `min-h-dvh bg-background` wrapper.

**Files:**
- `src/components/pages/page-detail-shell.tsx` (current: lines 22-23 already carry the round-1 classes)
- Suspect interaction: the absolutely-positioned `TocSidebar` aside in `page.tsx` (~L134-140, `xl:w-56` right rail) and `SeeAlsoPanel` — the "empty whitespace" may be the **reserved-but-empty TOC rail gutter**, not the reading column.

- [ ] **Step 1: DIAGNOSE why 677f033 didn't hold**

The shell already centers the column. So the persistent "empty whitespace right of content" is likely NOT the shell padding. Investigate:
- Is the void the **TOC sidebar gutter**? In `page.tsx` the `<aside className="… absolute right-4 top-32 hidden xl:block xl:w-56">` reserves right-rail space on xl+ *only when `showTocSidebar`*. If the gutter shows empty (cookie on, doc has no headings) or the absolute positioning leaves a dead band beside the `max-w-3xl` column, that reads as accidental whitespace.
- Is it the **focus-mode** layout? When `cairn-focus-mode` hides the sidebar (`globals.css` L190-192) but the column stays `max-w-3xl mx-auto`, the freed left+right space becomes a large void — the reading column doesn't widen to use it.
- Stale build (hypothesis #1)?

Determine which surface the audit screenshot showed (focus mode vs normal vs TOC-on). Note it in the commit.

- [ ] **Step 2: Re-fix per the confirmed cause**

- If **TOC gutter void:** when TOC is enabled, make the layout a deliberate 2-column grid (content + `xl:w-56` rail) instead of an absolute overlay over empty space, OR widen the content `max-w` when no TOC. Ensure the empty rail collapses (no reserved width) when there are no headings.
- If **focus-mode void:** in focus mode, widen/recentre the column (e.g. bump `max-w` or add a focus-scoped `max-w-4xl`) so the freed space is used intentionally.
- If **stale build:** confirm source is correct, add the rebuild note, optionally a snapshot/computed-style guard.

Keep `min-h-dvh bg-background` so there's never a bare void below the fold.

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. `pnpm dev` at wide viewport: normal, focus, and TOC-on states each read as intentional layout, no orphan void band.

- [ ] **Step 4: Commit**

```bash
git add src/components/pages/page-detail-shell.tsx "src/app/(app)/pages/[pageId]/page.tsx"
git commit -m "fix(editor): remove accidental whitespace beside content column — Closes #18"
```

---

### Task 6: Diagnose + re-fix empty database block header row (#19)

**Round-1 attempt:** P03 commit `7c7d7bb` — `table-view.tsx` `rows.length === 0` branch renders a div-based ARIA-grid header (`role="grid"/"row"/"columnheader"`) before the "No rows yet" hint.

**Files:**
- `src/components/databases/table-view.tsx` (empty branch ~L296-341)
- Suspect: `src/components/databases/database-block.tsx` (may short-circuit to an empty state *before* mounting `TableView`); and the **grouped** path (`grouped && groupByProp`, L198-214) which renders a real `<table>` whose `<thead>` shows — but does the empty-grouped or empty-other-view case keep headers?

- [ ] **Step 1: DIAGNOSE why 7c7d7bb didn't hold**

The empty header branch exists in `table-view.tsx` for the **non-grouped** path. Check:
- Does `database-block.tsx` (or the view-switcher) render its own "empty database" placeholder and never reach `TableView` when `rows.length === 0`? Read it. (hypothesis #3 — most likely.)
- Is the deployed DB view **not** the table view (kanban/gallery), so the table header fix is irrelevant to what the reviewer saw? Confirm which view the audit hit.
- Does the **grouped** path produce zero groups when `rows=[]` (so the `<thead>` renders but with no `<tbody>` — acceptable), or does an upstream guard hide the whole table?
- Stale build (hypothesis #1)?

Note which in the commit.

- [ ] **Step 2: Write/extend the failing test at the REAL render boundary**

If the diagnosis is that `database-block.tsx` short-circuits, write the guard test against `DatabaseBlock` (or whatever component owns the empty decision), asserting a column header (`getByText('<property name>')`) renders with zero rows — not just against `TableView` (which already passes). Read the component's real props first.

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/empty-db-header.test.tsx` (or the new file) — confirm it FAILS at the true boundary.

- [ ] **Step 3: Re-fix**

Ensure the **always-rendered** path guarantees a header when ≥1 property exists, regardless of which component decides "empty" — move/duplicate the header guarantee up to `database-block.tsx` if it owns the early return, and ensure non-table views also show column context or are explicitly out of scope (document). Keep the existing div-grid header for the table view.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/ && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS, clean. `pnpm dev`: a freshly-created (zero-row) inline database shows its column header(s) + "No rows yet" hint.

- [ ] **Step 5: Commit**

```bash
git add src/components/databases/table-view.tsx src/components/databases/database-block.tsx tests/components/databases/empty-db-header.test.tsx
git commit -m "fix(databases): guarantee header row for empty DB at render boundary — Closes #19"
```

---

### Task 7: Diagnose + re-fix full-size headings inside callouts (#20)

**Round-1 attempt:** P03 commit `bfb6e0b` — added `.prose .callout :is(h1…h6)` scaled-down heading rules to `code-highlight.css` (currently L163-190).

**Files:**
- `src/components/editor/code-highlight.css` (`.prose .callout` heading scale ~L163-190)
- Reference: `src/components/editor/editor.tsx` L197 (`prose prose-sm sm:prose-base dark:prose-invert max-w-none`) — confirms the editor body IS a `.prose` container; `src/app/globals.css` typography.

- [ ] **Step 1: DIAGNOSE why bfb6e0b didn't hold**

The `.prose .callout h1{…}` rules exist. So the likely cause is **specificity or build order lost in production** (hypothesis #2). Check:
- Does the Tailwind typography plugin emit heading rules at **equal-or-higher specificity** that win in the production build (where rule order differs from dev)? `prose-sm`/`prose-base` set responsive heading sizes via `:where()` (specificity 0) — but `dark:prose-invert` and the responsive `sm:prose-base` variants can re-declare at higher order. If `.prose .callout h1` (specificity 0,2,1) is *emitted before* a later `.prose :where(h1)` it could lose by source order in the purged bundle.
- Is `code-highlight.css` **imported after** the Tailwind layers in production but **before** in dev (load-order divergence)? Check where `code-highlight.css` is imported (grep `code-highlight.css`) relative to `globals.css`/Tailwind.
- Could Tailwind v4 purge be dropping `.prose .callout` rules it deems unused (the `.callout` class is generated by the node-view at runtime, not present in scanned source)? If so they're stripped from prod CSS entirely. **This is the strongest candidate** — verify by grepping the built CSS after `pnpm build` for `.callout h1`.
- Stale build (hypothesis #1)?

- [ ] **Step 2: Re-fix per cause**

- If **purge drops the rules:** add the callout classes to a Tailwind v4 safelist/`@source inline(...)` or move these rules into a layer the purge keeps, OR (simplest, robust) bump specificity so they're clearly authored selectors and ensure the file is imported into a non-purged global stylesheet. Confirm post-build CSS contains `.callout h1`.
- If **specificity/order:** raise specificity (e.g. `.prose :where(.callout) :is(h1,…)` won't help — instead use `.prose .callout h1` with `!important` only if necessary, or scope under `[data-type="callout"]` which the node renders, e.g. `.prose [data-type="callout"] h1`). Prefer the data-attr selector since `callout-extension.ts` always emits `data-type="callout"`.
- Verify in the **built** bundle, not just dev.

- [ ] **Step 3: Verify (build-output assertion)**

Run: `source ~/.zshenv && pnpm build` then grep the emitted CSS for the callout heading rule:
```bash
source ~/.zshenv && grep -rl "callout" .next/static/css/ 2>/dev/null | head -1 | xargs grep -o "callout[^{]*h1[^}]*" 2>/dev/null | head
```
Expected: the scaled heading rule survives into the production CSS. `pnpm dev` + a `pnpm build && pnpm start` spot check: H1 inside a callout is visibly smaller than a page H1 in BOTH.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/code-highlight.css
git commit -m "fix(editor): callout headings stay scaled in production build — Closes #20"
```

---

### Task 8: Diagnose + re-fix editor tab strip separators/active state (#39)

**Round-1 attempt:** P03 commit `d98e257` — `editor.tsx` (~L478-505) added `h-4 w-px bg-border` separators + a status pill + outline `aria-pressed`; `suggestion-toolbar.tsx` added the `Suggesting` active variant + the `N open` muted chip.

**Files:**
- `src/components/editor/editor.tsx` (top control strip ~L476-510)
- `src/components/editor/suggestion-toolbar.tsx`

- [ ] **Step 1: DIAGNOSE why d98e257 didn't hold**

Both files already contain the round-1 markup (separators, status pill, `aria-pressed`, `N open` chip). So the reopen is most likely **stale build** (hypothesis #1) OR the separators/active states render only under a state the deploy didn't show:
- The first separator + `SuggestionToolbar` render **only when `effectiveEditable`** (`editor.tsx` ~L486). A **viewer** (read-only deploy account, or the public share view) sees the strip WITHOUT the suggest-edits group and its separator — so to a reviewer logged in as a viewer the strip still looks like bare labels. Confirm the audit was done as an editor vs viewer.
- Is there a **separate** tab strip elsewhere (e.g. a mobile toolbar, or the `/p/<slug>` reader) that was never patched? Grep for the Outline/Live controls duplicated.
- Tailwind purge dropping `bg-border`/`w-px` utility? Unlikely (utilities are scanned) — rule out quickly.
- Stale build?

Note the confirmed cause in the commit.

- [ ] **Step 2: Re-fix per cause**

- If **viewer path is bare:** ensure the strip reads as structured controls even read-only — render the status pill + Outline toggle with the separator regardless of `effectiveEditable`, and only gate the suggest-edits group. Verify the separators don't dangle (no leading/trailing separator when a group is absent).
- If **duplicate strip** elsewhere: apply the same separator/active treatment there.
- If **stale build:** confirm source, note the rebuild as the durable fix, optionally add a render guard test asserting the strip contains `aria-pressed` toggles + a separator element.

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. `pnpm dev` as BOTH an editor and a viewer: the strip shows distinct, separated controls with visible active/pressed states (Suggest edits, status pill, Outline) in both roles.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/editor.tsx src/components/editor/suggestion-toolbar.tsx
git commit -m "fix(editor): tab-strip separators + active state hold for all roles — Closes #39"
```

---

## Self-Review

- Spec coverage: NEW #57 (neutral callout), #58 (Auto-detect), #59 (empty-toggle placeholder); REOPENED #17, #18, #19, #20, #39 — each with a mandatory diagnose-first step referencing its round-1 commit (c8f4619 / 677f033 / 7c7d7bb / bfb6e0b / d98e257). ✓
- Yjs-safety honored: callout/code-block/toggle node-views read attrs + render display-only DOM (`contentEditable={false}`, `pointer-events-none`); no render-time attr writes; the existing code-block "no detection write-back" precedent is preserved. ✓
- i18n gate: every new string (#58 tooltip, #59 placeholder) routed through `t()` or a justified `// biome-ignore i18n` + re-baseline, with `pnpm i18n:check` in the verify step; `messages/{en,es,ar}.json` updated where keys are added. ✓
- WCAG AA: #57 neutral callout contrast verified (`--foreground` over `--muted`, both themes) with the base `.callout` precedent as evidence; touch targets unaffected. ✓
- Verify gate per task (`lint`+`typecheck`+`test`, `build` for UI, `i18n:check` for new strings); one commit per task with `Closes #NN`; no push. ✓
- Reopened diagnosis is genuine, not cosmetic: the plan documents that the round-1 source edits are ALL present in the tree, so re-applying them verbatim would reproduce the non-fix — Step 1 of each reopened task forces identifying the real systemic cause (stale artifact / prod CSS purge+order / unexercised render branch / second render site) before touching code. ✓
