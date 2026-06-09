# Plan C — Top-of-Sidebar Density (#144) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact the TOP of the desktop sidebar — the four interactive rows above the PAGES tree (workspace switcher, command-palette button, section headers, PAGES header) — so the tree starts higher on the screen, while preserving the established `pointer-coarse:min-h-11` 44px touch floor and the new workspace-icon badge from PR #320.

**Architecture:** Pure CSS/className changes on four existing client/presentational components. We reuse the established sidebar density convention: dense box heights are applied on *fine* pointers (desktop mouse) via fixed `min-h-[Npx]` / reduced `py-*`, and a `pointer-coarse:min-h-11` (and where padding shrinks, `pointer-coarse:py-1.5`) override restores the 44px WCAG 2.5.5 target on touch. This is the exact pattern already shipped in `sidebar-footer-nav.tsx`, `sidebar/study-link.tsx` (v0.9.11/13). Font sizing continues to flow through the `--cairn-sidebar-*` tokens in `globals.css`; we do **not** hardcode new font px where a token already expresses it. No new tokens are introduced — the body-text token (`--cairn-sidebar-text: 13px`) already matches the "font 14→13" target for the switcher.

**Tech Stack:** Next.js 16 / React 19, Tailwind CSS v4 (CSS-first `@theme` in `src/app/globals.css`, no config file), Vitest v4 + jsdom for source-assertion UI specs. Biome v2 for lint/format.

---

## Grounding (read before implementing)

Real components, exact current state (cited from `release/v0.9.16` @ `5781de6`):

1. **Workspace switcher trigger row** — `src/components/workspace-switcher.tsx:58-72`. The `<DropdownMenu.Trigger>` currently carries:
   ```
   flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] font-medium hover:bg-accent
   ```
   It already uses the `--cairn-sidebar-text` (13px) font token (so the "font 14→13" target is *already met* on font — the win here is height). It renders the **InlineIcon badge** at lines 62-68 (the `<span aria-hidden>` with `h-5 w-5 ... bg-muted` wrapping `<InlineIcon value={active?.icon ...}>`). **This badge is PR #320's #142 work and MUST survive the density change** — the badge span is a child of the trigger, untouched by the trigger's height/padding edit. `py-1.5` (6px top+bottom) + `min-h-11` (44px) currently drive the ~44px row.

2. **Command-palette / search button** — `src/components/search-hint-button.tsx:20-34`. Current button className:
   ```
   mb-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent
   ```
   Note it uses **`text-sm` (14px), not the density token** — a regression to fix in passing so it matches sibling rows. The ⌘K `<kbd>` (line 30) is `text-[10px]`.

3. **Section header — "Saved searches"** — `src/components/sidebar/saved-searches.tsx:84-91`. The `<section>` is `mb-3`; the header `<div>` is `mb-1 flex items-center gap-2 px-2`; the label `<p>` is `text-xs uppercase tracking-wide text-muted-foreground` (12px). There is **no kbd** in this header — see "Spec reconciliation" below.

4. **PAGES header row** — `src/components/sidebar/pages-section.tsx:23-51`. The header `<div data-pages-header>` is:
   ```
   sticky top-0 z-10 mb-1 flex items-center justify-between gap-1 bg-card px-2 py-1
   ```
   The label `<p id="sidebar-pages-heading">` is `text-xs uppercase tracking-wide text-muted-foreground`. The collapse/expand `<Button size="icon" className="h-6 w-6">` (line 38) and `<NewPageButton>` (`h-11 w-11`, `new-page-button.tsx:43`) sit in the right cluster. The `py-1` + the `h-11` NewPageButton currently force the header to ~52px.

5. **Density tokens** — `src/app/globals.css:90-101`:
   ```
   --cairn-sidebar-text: 13px;
   --cairn-sidebar-leading: 18px;
   --cairn-sidebar-px: 6px;
   --cairn-sidebar-section-gap: 6px;
   ```

6. **Established pointer-coarse precedent** (reuse, do not reinvent) — `src/components/sidebar-footer-nav.tsx:21`:
   ```
   ... min-h-[28px] ... py-1 ... pointer-coarse:min-h-11 pointer-coarse:py-1.5
   ```
   and `src/components/sidebar/study-link.tsx:18` (same shape). `min-h-[28px]` is the project's standard dense interactive-row height; `pointer-coarse:min-h-11` + `pointer-coarse:py-1.5` restores 44px on touch.

### Spec reconciliation (read carefully)

The brief lists target *pixel* heights (44→32, 54→36, 52→28) and a "kbd 12→11px" for section headers. Grounding the brief against the real source:

- **Heights are achieved via `min-h-[Npx]` on a fine pointer**, with `pointer-coarse:min-h-11` keeping ≥44px on touch. jsdom does **not** compute CSS, so tests assert the *class strings / token values*, not measured px. We adopt the project's existing dense height `min-h-[28px]` for the PAGES header label-area and use explicit `min-h-[32px]` (switcher) / `min-h-[36px]` (palette button) to hit the brief's fine-pointer targets. These are class-string assertions, not runtime measurements.
- **"Section headers kbd 12→11px"**: the section-header labels are `text-xs` (12px) `<p>` elements; there is **no `<kbd>`** in either the "Saved searches" header or the PAGES header. The only kbd in the top region is the ⌘K kbd on the command-palette button (`search-hint-button.tsx:30`), currently `text-[10px]`. We interpret the brief's intent as: shrink the section-header **label** from `text-xs` (12px) to `text-[11px]` to tighten the headers, and `mb-1 → mb-0.5` (4→2px) on the header rows. The ⌘K kbd stays `text-[10px]` (already below 11px; shrinking it further is out of scope). This interpretation is recorded in `## Out of scope`.

---

## File structure

- **Modify:** `src/components/workspace-switcher.tsx` — trigger row height/padding only (badge untouched).
- **Modify:** `src/components/search-hint-button.tsx` — button height/padding/margin + adopt density font token.
- **Modify:** `src/components/sidebar/saved-searches.tsx` — section `mb-3 → mb-2`, header `mb-1 → mb-0.5`, label `text-xs → text-[11px]`.
- **Modify:** `src/components/sidebar/pages-section.tsx` — header row `py-1 → py-0.5`, add dense `min-h-[28px]` + pointer-coarse floor, `mb-1 → mb-0.5`, label `text-xs → text-[11px]`.
- **Create:** `tests/ui/sidebar-top-density.spec.ts` — source-assertion spec for all four components + the pointer-coarse guard.

No new tokens; no changes to `globals.css`.

---

### Task 1: Write the failing source-assertion spec

**Files:**
- Test: `tests/ui/sidebar-top-density.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Mirror the existing `tests/ui/sidebar-density.spec.ts` style (read file via `node:fs`, assert on class substrings — CSS is not computed in jsdom).

```ts
/**
 * Plan C (v0.9.16, #144) — top-of-sidebar density.
 * Source-assertion slice: the four interactive rows above the PAGES tree are
 * compacted on FINE pointers while the pointer-coarse:min-h-11 (44px, WCAG
 * 2.5.5) touch floor is preserved. CSS is not computed in jsdom, so we assert
 * on the class strings / token references, not measured pixels.
 * See docs/superpowers/plans/v0.9.16/plan-C-top-sidebar-density.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const switcher = read('src/components/workspace-switcher.tsx');
const searchHint = read('src/components/search-hint-button.tsx');
const savedSearches = read('src/components/sidebar/saved-searches.tsx');
const pagesSection = read('src/components/sidebar/pages-section.tsx');

describe('Plan C #144 — workspace switcher trigger row', () => {
  it('compacts to 32px on fine pointer, keeps min-h-11 on coarse', () => {
    expect(switcher).toContain('min-h-[32px]');
    expect(switcher).toContain('pointer-coarse:min-h-11');
    // padding shrinks on fine pointer; touch restores py-1.5
    expect(switcher).toContain('py-0.5');
    expect(switcher).toContain('pointer-coarse:py-1.5');
    // density font token retained (was already 13px); no regression to text-sm
    expect(switcher).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(switcher).not.toMatch(/(^|["\s])text-sm(["\s])/);
  });

  it('keeps the #320 InlineIcon badge in the trigger', () => {
    // the density edit must not remove the workspace-icon badge (#142/#320)
    expect(switcher).toContain('<InlineIcon');
    expect(switcher).toMatch(/h-5 w-5[^"]*bg-muted/);
  });
});

describe('Plan C #144 — command palette button', () => {
  it('compacts to 36px on fine pointer, keeps min-h-11 on coarse', () => {
    expect(searchHint).toContain('min-h-[36px]');
    expect(searchHint).toContain('pointer-coarse:min-h-11');
    expect(searchHint).toContain('py-0.5');
    expect(searchHint).toContain('pointer-coarse:py-1.5');
    // mb 8 -> 4
    expect(searchHint).toContain('mb-1');
    expect(searchHint).not.toContain('mb-2');
    // adopt the density font token (was text-sm)
    expect(searchHint).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(searchHint).not.toMatch(/(^|["\s])text-sm(["\s])/);
  });
});

describe('Plan C #144 — section header (Saved searches)', () => {
  it('tightens margins and shrinks the label to 11px', () => {
    expect(savedSearches).toContain('mb-2'); // section was mb-3
    expect(savedSearches).not.toContain('mb-3');
    expect(savedSearches).toContain('mb-0.5'); // header row was mb-1
    expect(savedSearches).toContain('text-[11px]'); // label was text-xs
  });
});

describe('Plan C #144 — PAGES header row', () => {
  it('compacts the header to 28px dense, keeps coarse floor + badge-safe label', () => {
    expect(pagesSection).toContain('min-h-[28px]');
    expect(pagesSection).toContain('pointer-coarse:min-h-11');
    expect(pagesSection).toContain('py-0.5'); // was py-1
    expect(pagesSection).toContain('pointer-coarse:py-1.5');
    expect(pagesSection).toContain('mb-0.5'); // header was mb-1
    expect(pagesSection).toContain('text-[11px]'); // label was text-xs
    // sticky/z/bg chrome from C3 (#209) must remain
    expect(pagesSection).toContain('sticky top-0 z-10');
    expect(pagesSection).toContain('bg-card');
  });
});
```

- [ ] **Step 2: Run the spec to verify it FAILS on current source**

Run: `source ~/.zshenv && pnpm vitest run tests/ui/sidebar-top-density.spec.ts`
Expected: FAIL. Current source has `min-h-11`/`py-1.5` (switcher), `text-sm`/`mb-2`/`py-1.5` (search hint), `mb-3`/`mb-1`/`text-xs` (saved-searches), `py-1`/`mb-1`/`text-xs`/no `min-h-[28px]` (pages-section). All new-value assertions fail; e.g. `expect(searchHint).toContain('min-h-[36px]')` and `expect(savedSearches).not.toContain('mb-3')`.

- [ ] **Step 3: Commit the failing spec**

```bash
source ~/.zshenv && cd /Users/jon/projects/cairn
git add tests/ui/sidebar-top-density.spec.ts
git commit -m "test(sidebar): failing top-density spec (#144)"
```

---

### Task 2: Compact the workspace switcher trigger row

**Files:**
- Modify: `src/components/workspace-switcher.tsx:58-72`

- [ ] **Step 1: Edit the trigger className**

Replace the existing `<DropdownMenu.Trigger className="...">` value at line 60. Old:

```
flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] font-medium hover:bg-accent
```

New (32px dense on fine pointer; 44px floor + py-1.5 restored on coarse; font token unchanged; badge children untouched):

```
flex min-h-[32px] w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-0.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] font-medium hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:py-1.5
```

Do **not** touch lines 62-71 (the `<InlineIcon>` badge span + name + chevron). Leave the `ITEM_CLASS` dropdown-item constant (line 23-24, the menu rows) at its `min-h-11` — those are popover rows, not the top trigger, and are out of scope.

- [ ] **Step 2: Run the switcher describe block to verify it PASSES**

Run: `source ~/.zshenv && pnpm vitest run tests/ui/sidebar-top-density.spec.ts -t "workspace switcher"`
Expected: PASS (both `it`s — compaction + badge-safe).

- [ ] **Step 3: Commit**

```bash
source ~/.zshenv && cd /Users/jon/projects/cairn
git add src/components/workspace-switcher.tsx
git commit -m "feat(sidebar): compact workspace switcher row to 32px on fine pointer (#144)"
```

---

### Task 3: Compact the command-palette button

**Files:**
- Modify: `src/components/search-hint-button.tsx:20-27`

- [ ] **Step 1: Edit the button className**

Replace the `<button className="...">` value at line 26. Old:

```
mb-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent
```

New (36px dense on fine pointer; 44px floor + py-1.5 on coarse; `mb-2`→`mb-1` = 8→4px; `text-sm`→density token to match sibling rows):

```
mb-1 flex min-h-[36px] w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-0.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:py-1.5
```

Leave the `<kbd>` (line 30) at `text-[10px]` and the `<Search>` icon at `h-4 w-4` — only the row box changes.

- [ ] **Step 2: Run the palette button describe block to verify it PASSES**

Run: `source ~/.zshenv && pnpm vitest run tests/ui/sidebar-top-density.spec.ts -t "command palette button"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
source ~/.zshenv && cd /Users/jon/projects/cairn
git add src/components/search-hint-button.tsx
git commit -m "feat(sidebar): compact command-palette button to 36px + density font (#144)"
```

---

### Task 4: Tighten the "Saved searches" section header

**Files:**
- Modify: `src/components/sidebar/saved-searches.tsx:85-90`

- [ ] **Step 1: Edit the section + header + label classes**

At line 85, the `<section>` wrapper:

Old: `<section aria-label={t('savedSearches.heading')} className="mb-3">`
New: `<section aria-label={t('savedSearches.heading')} className="mb-2">`

At line 86, the header `<div>`:

Old: `<div className="mb-1 flex items-center gap-2 px-2">`
New: `<div className="mb-0.5 flex items-center gap-2 px-2">`

At line 88, the label `<p>`:

Old: `<p className="text-xs uppercase tracking-wide text-muted-foreground">`
New: `<p className="text-[11px] uppercase tracking-wide text-muted-foreground">`

The `<Bookmark>` icon (line 87, `h-3 w-3`) and the saved-search `<li>` rows (which already carry `min-h-11` on their action buttons) are out of scope — these are non-interactive header chrome edits.

- [ ] **Step 2: Run the section-header describe block to verify it PASSES**

Run: `source ~/.zshenv && pnpm vitest run tests/ui/sidebar-top-density.spec.ts -t "section header"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
source ~/.zshenv && cd /Users/jon/projects/cairn
git add src/components/sidebar/saved-searches.tsx
git commit -m "feat(sidebar): tighten Saved-searches header margins + 11px label (#144)"
```

---

### Task 5: Compact the PAGES header row

**Files:**
- Modify: `src/components/sidebar/pages-section.tsx:23-32`

- [ ] **Step 1: Edit the header row + label classes**

At lines 23-26, the header `<div data-pages-header>`:

Old:
```
<div
  data-pages-header=""
  className="sticky top-0 z-10 mb-1 flex items-center justify-between gap-1 bg-card px-2 py-1"
>
```

New (keep C3's sticky/z/bg chrome; add the dense 28px height + coarse floor; py 1→0.5; mb 1→0.5):
```
<div
  data-pages-header=""
  className="sticky top-0 z-10 mb-0.5 flex min-h-[28px] items-center justify-between gap-1 bg-card px-2 py-0.5 pointer-coarse:min-h-11 pointer-coarse:py-1.5"
>
```

At lines 27-31, the label `<p id="sidebar-pages-heading">`:

Old:
```
<p
  id="sidebar-pages-heading"
  className="text-xs uppercase tracking-wide text-muted-foreground"
>
```

New:
```
<p
  id="sidebar-pages-heading"
  className="text-[11px] uppercase tracking-wide text-muted-foreground"
>
```

Do **not** change the collapse `<Button className="h-6 w-6">` (line 38) or the `<NewPageButton>` (line 49). The `NewPageButton` is `h-11 w-11` (`new-page-button.tsx:43`) — leaving it intact keeps a 44px touch target inside the header on every pointer, which is *fine* (the row's `min-h-[28px]` is a floor, not a cap; the 44px child still satisfies WCAG 2.5.5 for that control on touch). The header's own `pointer-coarse:min-h-11` guarantees the row itself never drops below 44px on touch.

- [ ] **Step 2: Run the PAGES header describe block to verify it PASSES**

Run: `source ~/.zshenv && pnpm vitest run tests/ui/sidebar-top-density.spec.ts -t "PAGES header"`
Expected: PASS.

- [ ] **Step 3: Run the full spec to verify ALL blocks PASS**

Run: `source ~/.zshenv && pnpm vitest run tests/ui/sidebar-top-density.spec.ts`
Expected: PASS (4 describe blocks, 6 `it`s green).

- [ ] **Step 4: Commit**

```bash
source ~/.zshenv && cd /Users/jon/projects/cairn
git add src/components/sidebar/pages-section.tsx
git commit -m "feat(sidebar): compact PAGES header to 28px on fine pointer (#144)"
```

---

### Task 6: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Lint + typecheck + full test + build**

Run:
```bash
source ~/.zshenv && cd /Users/jon/projects/cairn
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all green. (Biome may reorder/reflow the edited class strings — accept its `--write` output; the token/class substrings the spec asserts are order-independent.)

- [ ] **Step 2: Confirm no regression in the existing density specs**

Run: `source ~/.zshenv && pnpm vitest run tests/ui/sidebar-density.spec.ts tests/components/workspace-switcher-density.test.tsx tests/components/sidebar-density-saved-searches.test.tsx`
Expected: PASS. (The pre-existing switcher density test asserts the font token + `min-h-11` substring; our new `min-h-[32px]` adds a token but the string `min-h-11` still appears via `pointer-coarse:min-h-11`, so that assertion stays green. Verify this explicitly — if the old test asserted `min-h-11` as a *standalone* class boundary and now only `pointer-coarse:min-h-11` is present, update that test in the same task to match the coarse-prefixed form.)

- [ ] **Step 3: HOLD — do not push.**

Per project convention, subagents/implementers do not push; the controller/human pushes. Stop here after the gate is green.

---

## Coverage check (#144)

| #144 target | Task | How it lands |
|---|---|---|
| Workspace switcher 44→32px (py 6→3, font 14→13) | Task 2 | `min-h-[32px]` + `py-0.5` on fine; font already on `--cairn-sidebar-text` (13px), kept. |
| Command palette button 54→36px (py 6→3, mb 8→4) | Task 3 | `min-h-[36px]` + `py-0.5` + `mb-1`; font moved off `text-sm` onto density token. |
| Section headers mb 4→2, kbd 12→11px | Task 4 | header `mb-1→mb-0.5`; label `text-xs(12px)→text-[11px]`. (No kbd exists in section headers — see Spec reconciliation; the 11px applies to the label, the brief's apparent intent.) |
| PAGES header row 52→28px | Task 5 | `min-h-[28px]` + `py-0.5` + `mb-0.5` + 11px label. |
| Preserve #320 InlineIcon badge | Task 1 (assert) + Task 2 (untouched) | Spec asserts `<InlineIcon` + the badge span survive; Task 2 edits only the trigger box class, not its children. |
| Preserve 44px touch floor (WCAG 2.5.5) | every interactive-row task | each fine-pointer dense height is paired with `pointer-coarse:min-h-11` (+ `pointer-coarse:py-1.5` where padding shrinks), reusing the shipped `sidebar-footer-nav.tsx` / `study-link.tsx` pattern. |

## Failure modes verified

- **Spec fails on current `main`/`release/v0.9.16`:** Task 1 Step 2 runs the spec against unmodified source and expects FAIL — the new-value assertions (`min-h-[36px]`, `min-h-[32px]`, `not.toContain('mb-3')`, `text-[11px]`, etc.) cannot pass against the current `min-h-11`/`text-sm`/`mb-3`/`text-xs` source. This proves the spec is not a tautology.
- **Spec passes after the edits:** Task 5 Step 3 runs the full spec green after Tasks 2-5 land.
- **Touch-target regression caught:** every interactive-row assertion pairs the dense `min-h-[Npx]` check with a `pointer-coarse:min-h-11` (and, where padding shrinks, `pointer-coarse:py-1.5`) check. If an implementer drops the coarse override while shrinking the row, the spec fails — the 44px floor cannot silently regress.
- **Badge regression caught:** the switcher block asserts `<InlineIcon` and the `h-5 w-5 ... bg-muted` badge span still exist; deleting the #320 badge while compacting the row fails the spec.
- **Font regression caught:** the switcher + palette-button blocks assert the density font token is present and `text-sm` is absent, so reverting to `text-sm` fails.

## Out of scope

- **No new tokens / no `globals.css` change.** The body-text token already encodes 13px; heights are local `min-h-[Npx]` per the project's established per-row convention.
- **`<kbd>` font size unchanged.** The only kbd in the top region (⌘K on the palette button, `search-hint-button.tsx:30`) is already `text-[10px]`, below the brief's "→11px"; shrinking it further is not pursued. The "kbd 12→11px" line is reconciled as the section-**label** 12→11px (see Spec reconciliation).
- **Dropdown menu rows** (`ITEM_CLASS` in `workspace-switcher.tsx:23`) stay `min-h-11` — those are popover items, not the top trigger.
- **Saved-search `<li>` action buttons** keep their `h-11 w-11` / `min-h-11` targets — only header chrome is tightened.
- **`NewPageButton` and the collapse/expand `Button`** in the PAGES header keep their existing sizes (`h-11 w-11` / `h-6 w-6`); the row floor change does not cap them.
- **The PAGES tree rows themselves** (`virtualized-page-tree.tsx`) — already compacted in v0.9.14 C2 (#208); untouched here.
- **No runtime/computed-px assertions.** jsdom does not compute CSS; verification is source-assertion only. Visual px confirmation is a manual/human check, not part of this plan's gate.

---

**Plan complete.** Execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review + commit between tasks.

**2. Inline Execution** — execute in this session via executing-plans with checkpoints.

Which approach?
