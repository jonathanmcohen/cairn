# P12 — Templates Gallery Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix three audit findings in the templates gallery (`src/components/templates/templates-gallery.tsx`): the orphan-card grid imbalance, the indistinguishable grey kind/Built-in badges, and the raw `►` Unicode disclosure glyph. All three are presentational and isolated to one component plus its existing test.

**Architecture:** The gallery renders one `<section>` per visibility tier (`workspace`/`public`/`private`), each containing a responsive CSS grid of `<Card>`s. The current grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — with 4 cards in a tier (e.g. 3 built-ins + 1 workspace, or a 4-template public tier) the 3-col breakpoint leaves a lone orphan on row 2 (#51). The kind badge (`page`/`database`) and the `Built-in` badge are both bordered grey pills with `text-muted-foreground`, so they read as the same thing (#52). The `<details><summary>Preview</summary>` row relies on the browser's default `►`/`▼` marker, which renders as a raw Unicode triangle (#53). We keep the existing `<details>` semantics (free a11y + keyboard) but suppress the native marker and render a rotating lucide `ChevronRight`, mirroring the toggle-block pattern in `src/components/editor/blocks/toggle-view.tsx` (`<ChevronRight className="size-4 transition-transform … rotate-90" />`).

**Tech Stack:** React 19, Tailwind v4 (`@theme` tokens in `src/app/globals.css`; no config file), `lucide-react`, `cn()` from `src/lib/utils.ts`. Biome v2 lint, Vitest v4. The repo has an i18n audit gate (`pnpm i18n:check` in CI, baseline at `i18n-audit.baseline.json`).

**i18n constraint:** A Biome/CI gate flags new hardcoded UI strings against `i18n-audit.baseline.json`. This plan introduces **no new visible strings** — `page`/`database`/`Built-in`/`Preview`/`In this workspace` all already exist in the component (and thus the baseline). Icons and `aria-label`s reuse existing literals. If any step is changed to add a new string, the implementer MUST run `source ~/.zshenv && pnpm i18n:baseline` and commit the regenerated baseline in the same commit, then justify the new finding.

**Accessibility constraint:** New badge styling MUST keep WCAG AA contrast (≥ 4.5:1 for the badge text). Reuse the existing semantic color tokens (`--color-primary` / `--color-secondary` / `--color-muted` and their `*-foreground` pairs from `src/app/globals.css`), which are already AA-tuned for both light and dark themes — do NOT introduce raw hex/`hsl()` colors. The disclosure chevron is decorative (the `<summary>` text "Preview" carries the label), so mark it `aria-hidden`.

**Covers:** GH #51 (audit — orphan grid card), #52 (audit — indistinguishable badges), #53 (audit — raw `►` disclosure glyph). All three live in `src/components/templates/templates-gallery.tsx`; the existing test is `tests/components/templates/gallery-visibility.test.tsx`.

---

### Task 1: Rebalance the gallery grid so a 4th card never orphans (#51)

**Files:**
- Modify: `src/components/templates/templates-gallery.tsx` (the grid `<div>`, ~L125)
- Test: `tests/components/templates/gallery-visibility.test.tsx` (exists — keep passing; add one grid-class assertion)

- [ ] **Step 1: Read the current grid and confirm the breakpoints**

The grid wrapper inside each `<section>` is:

```tsx
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
```

At `lg` (3 cols) a tier of 4 cards lays out `3 + 1`, leaving the 4th card orphaned. The bundled welcome set is 3 built-ins, and the `public` tier carries built-ins + shared templates, so 4-card tiers are the common case the audit hit.

- [ ] **Step 2: Add a grid-class assertion to the existing test**

In `tests/components/templates/gallery-visibility.test.tsx`, add a focused test that the rendered grid uses the rebalanced breakpoints. Read the file first to reuse its existing `render(<TemplatesGallery … />)` setup and fixture builders; mirror the existing query style. Add:

```tsx
  it('uses a 4-col grid at xl so a 4th card fills the row instead of orphaning', () => {
    const { container } = render(
      <TemplatesGallery initialTemplates={fourPublicTemplates} />,
    );
    const grid = container.querySelector('section [class*="grid-cols"]');
    expect(grid?.className).toContain('xl:grid-cols-4');
    expect(grid?.className).toContain('sm:grid-cols-2');
  });
```

If the file has no 4-template fixture, build one inline from the existing single-template factory (4 `builtIn: true` cards land in the `public` tier). Keep the existing visibility-grouping tests untouched.

- [ ] **Step 3: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/templates/gallery-visibility.test.tsx`
Expected: FAIL — the new assertion sees `lg:grid-cols-3` but no `xl:grid-cols-4`.

- [ ] **Step 4: Rebalance the grid**

Replace the grid wrapper class so 2-up is the widest mid breakpoint and a 4th card completes a row at `xl`:

```tsx
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
```

Rationale: `sm:grid-cols-2` + `xl:grid-cols-4` makes any even count (2/4) fill its rows; collapsing the `lg` step to 2 columns means the only place a single trailing card can sit alone is an odd-count tier (1/3/5…), where a partial last row is expected, not an orphan from an even count on a 3-wide grid. This is a pure className change — no markup, props, or strings move.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/templates/gallery-visibility.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/templates/templates-gallery.tsx tests/components/templates/gallery-visibility.test.tsx
git commit -m "fix(templates): rebalance gallery grid to avoid orphan card — Closes #51"
```

---

### Task 2: Visually differentiate the kind badge from the Built-in badge (#52)

**Files:**
- Modify: `src/components/templates/templates-gallery.tsx` (badge row ~L130-144; import row ~L3-8)
- Test: `tests/components/templates/gallery-visibility.test.tsx` (add badge-distinction assertion)

- [ ] **Step 1: Read the current badge row**

Today all three pills share the same grey treatment, so `page`/`database` (the *kind*) is indistinguishable from `Built-in` (the *source*):

```tsx
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                        {t.kind}
                      </span>
                      {t.builtIn ? (
                        <span className="rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Built-in
                        </span>
                      ) : null}
                      {activeWorkspaceId && t.workspaceId === activeWorkspaceId ? (
                        <span className="rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          In this workspace
                        </span>
                      ) : null}
                    </div>
```

- [ ] **Step 2: Add a failing assertion that the two badges differ**

In `tests/components/templates/gallery-visibility.test.tsx`, render a built-in `page` template and assert the kind badge and the Built-in badge carry different classNames (and that the kind badge gets an icon). Read the file first for its fixture helpers; add:

```tsx
  it('renders the kind badge and the Built-in badge with distinct styling', () => {
    render(<TemplatesGallery initialTemplates={[builtInPageTemplate]} />);
    const kind = screen.getByText('page').closest('span');
    const builtIn = screen.getByText('Built-in').closest('span');
    expect(kind?.className).not.toEqual(builtIn?.className);
    // kind badge carries a leading lucide icon (decorative)
    expect(kind?.querySelector('svg')).toBeTruthy();
  });
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/templates/gallery-visibility.test.tsx`
Expected: FAIL — both badges currently share identical classes and neither has an `<svg>`.

- [ ] **Step 3: Add the lucide icon import**

The kind is a finite union (`'page' | 'database'`, see the `TemplateCard` type ~L13). Add `FileText` + `Database` to the imports (Biome will sort these):

```tsx
import { ChevronRight, Database, FileText } from 'lucide-react';
```

(`ChevronRight` is added here for reuse — Task 3 also needs it; importing once keeps a single lucide import line.)

- [ ] **Step 4: Differentiate the badges**

Give each badge a distinct, AA-safe semantic treatment. The **kind** badge becomes a `secondary`-toned pill with a leading kind-specific icon (page → `FileText`, database → `Database`); the **Built-in** badge becomes a `primary`-toned pill; the existing `In this workspace` badge stays the neutral `muted` outline so all three are mutually distinguishable. Replace the badge row with:

```tsx
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded border border-transparent bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                        {t.kind === 'database' ? (
                          <Database aria-hidden className="size-3" />
                        ) : (
                          <FileText aria-hidden className="size-3" />
                        )}
                        {t.kind}
                      </span>
                      {t.builtIn ? (
                        <span className="rounded border border-transparent bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                          Built-in
                        </span>
                      ) : null}
                      {activeWorkspaceId && t.workspaceId === activeWorkspaceId ? (
                        <span className="rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          In this workspace
                        </span>
                      ) : null}
                    </div>
```

Notes:
- `bg-secondary`/`secondary-foreground` and `bg-primary`/`primary-foreground` are paired tokens defined in `src/app/globals.css` `@theme` (~L64-67) and are AA-tuned for both themes — that pairing is what guarantees the WCAG AA contrast requirement; do not split the pairs or hand-pick colors.
- Icons are decorative (`aria-hidden`); the text `page`/`database`/`Built-in` carries meaning, so screen-reader output is unchanged.
- No new visible strings: `page`, `database`, and `Built-in` already existed.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/templates/gallery-visibility.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/templates/templates-gallery.tsx tests/components/templates/gallery-visibility.test.tsx
git commit -m "fix(templates): differentiate kind vs Built-in badges (color + icon) — Closes #52"
```

---

### Task 3: Replace the raw `►` disclosure glyph with a rotating ChevronRight (#53)

**Files:**
- Modify: `src/components/templates/templates-gallery.tsx` (the `<details>` Preview block ~L147-152)
- Test: `tests/components/templates/gallery-visibility.test.tsx` (assert chevron rendered, native marker suppressed)

- [ ] **Step 1: Read the current disclosure block**

The browser draws the default `►`/`▼` marker on the `<summary>`:

```tsx
                    {t.builtIn && BUILT_IN_DESCRIPTIONS[t.name] ? (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer select-none">Preview</summary>
                        <p className="mt-1">{BUILT_IN_DESCRIPTIONS[t.name]}</p>
                      </details>
                    ) : null}
```

- [ ] **Step 2: Add a failing assertion for the chevron**

In `tests/components/templates/gallery-visibility.test.tsx`, render a built-in template that has a `BUILT_IN_DESCRIPTIONS` entry (e.g. `'Welcome to Cairn'`, defined ~L23-27 of the component) and assert the summary now contains a lucide chevron and suppresses the native marker. Add:

```tsx
  it('renders a lucide chevron in the Preview disclosure (no raw marker)', () => {
    render(<TemplatesGallery initialTemplates={[welcomeBuiltInTemplate]} />);
    const summary = screen.getByText('Preview').closest('summary');
    expect(summary?.querySelector('svg')).toBeTruthy();
    expect(summary?.className).toContain('list-none');
  });
```

Use the real template `name` `'Welcome to Cairn'` in the fixture so `BUILT_IN_DESCRIPTIONS[t.name]` is truthy and the `<details>` renders.

Run: `source ~/.zshenv && pnpm vitest run tests/components/templates/gallery-visibility.test.tsx`
Expected: FAIL — no `<svg>` in the summary, no `list-none`.

- [ ] **Step 3: Render the rotating chevron (mirror `toggle-view.tsx`)**

`ChevronRight` is already imported (Task 2, Step 3). The native `<details>` marker is suppressed with Tailwind's `list-none` plus the WebKit pseudo-element utility, and the chevron rotates 90° when the parent `<details>` is `[open]` — the same `transition-transform` + `rotate-90` pattern as the toggle block. Replace the disclosure block with:

```tsx
                    {t.builtIn && BUILT_IN_DESCRIPTIONS[t.name] ? (
                      <details className="group text-xs text-muted-foreground">
                        <summary className="flex cursor-pointer list-none select-none items-center gap-1 [&::-webkit-details-marker]:hidden">
                          <ChevronRight
                            aria-hidden
                            className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
                          />
                          Preview
                        </summary>
                        <p className="mt-1">{BUILT_IN_DESCRIPTIONS[t.name]}</p>
                      </details>
                    ) : null}
```

Notes:
- `group` on `<details>` + `group-open:rotate-90` drives the rotation from the native open state — no React state, so keyboard/space-toggle and SSR markup are preserved.
- `list-none` + `[&::-webkit-details-marker]:hidden` removes the default triangle in all engines (Firefox honors `list-none`; WebKit/Blink need the pseudo-element rule).
- Chevron is decorative (`aria-hidden`); the visible `Preview` text is the accessible name. No new strings.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/templates/gallery-visibility.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full verify gate**

Run: `source ~/.zshenv && pnpm vitest run tests/components/templates/gallery-visibility.test.tsx && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm build`
Expected: tests PASS; Biome clean; `tsc` clean; `i18n:check` reports "none new" (no baseline diff — we added zero strings); `next build` succeeds. If `i18n:check` reports a NEW finding, a step accidentally added a visible string — fix the string (route it through existing copy) rather than re-baselining, unless the new string is intentional, in which case run `pnpm i18n:baseline` and `git add i18n-audit.baseline.json`.

- [ ] **Step 6: Commit**

```bash
git add src/components/templates/templates-gallery.tsx tests/components/templates/gallery-visibility.test.tsx
git commit -m "fix(templates): replace raw ► disclosure glyph with rotating ChevronRight — Closes #53"
```

---

## Self-Review

- Spec coverage: #51 (grid rebalance), #52 (badge differentiation), #53 (chevron disclosure) — all three addressed, each its own commit with a `Closes #NN` trailer. ✓
- All edits confined to `src/components/templates/templates-gallery.tsx` + the existing `tests/components/templates/gallery-visibility.test.tsx`. ✓
- i18n gate: zero new visible strings; `pnpm i18n:check` in the verify gate proves no baseline diff. Re-baseline path documented as a fallback only. ✓
- WCAG AA: new badges reuse the paired, theme-tuned `secondary`/`primary` tokens (no raw colors); decorative icons/chevron are `aria-hidden`, accessible names unchanged. ✓
- Chevron mirrors `src/components/editor/blocks/toggle-view.tsx` (`ChevronRight` + `transition-transform` + `rotate-90`), driven by native `<details>` `group-open` so semantics/SSR/keyboard are preserved. ✓
- Verify gate (`vitest` + `lint` + `typecheck` + `i18n:check` + `build`) runs once after the last UI-affecting change. ✓
- Fixture/state names in the tests (`fourPublicTemplates`, `builtInPageTemplate`, `welcomeBuiltInTemplate`) are placeholders — the implementer MUST read `gallery-visibility.test.tsx` first and reuse its real factory helpers and `'Welcome to Cairn'` literal. ✓
