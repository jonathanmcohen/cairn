# Plan U — Notion-polish audit remainder

**Source:** `docs/superpowers/plans/v0.9.11/plan-u-notion-polish.md`, itself
derived from the v0.9.11 Notion-parity audit (the "20-point sweep" — the plan
extracted the actionable rows). Enumerated work items from that plan:

| U-row | Audit row | Item |
|-------|-----------|------|
| U1 | 1 | Typography — Inter via next/font + prose heading scale |
| U2 | 3 | Status-color token swaps — raw Tailwind → semantic tokens |
| U3 | 7 | Block-handle transition — transition-colors on hover buttons |
| U4 | 8 | Page-cover bottom hairline — 1px border under cover banner |
| U5 | 10 | Button press-scale — active:scale-[0.98], motion-reduce safe |
| U6 | 11 | Empty-state icons — add icons to 4 icon-less variants |
| U7 | 16 | Skeleton loaders — ui/skeleton.tsx + 3 surfaces |
| U8 | — | (plan's eighth slot; see re-audit below) |
| U9 | — | Verification gate — lint, typecheck, test, build, a11y |

## U1 (single v0.9.19 item) — re-audit, then ship the gaps

This plan letter is ONE item/PR in v0.9.19 (the rows are cosmetic and
file-disjoint; bundling them is the same judgment call as v0.9.18's per-item
rule applied at audit-row granularity — if the re-audit finds any row needing
non-trivial work (> ~30 lines or any behavior change), that row is split into
its own PR before merge, per the gates).

- Step 1 — re-audit: walk the 9 U-rows against current main (three releases
  have passed since v0.9.11; several rows likely shipped incidentally). Output:
  a checklist in the PR body — per row: SHIPPED (file:line proof) or GAP.
- Step 2 — ship the GAP rows only.
- Step 3 — full original "20-point" audit re-walk against the live preview
  (the source audit doc's remaining non-extracted rows): anything still
  unshipped and still wanted gets LISTED in the PR body for v0.9.20 triage —
  not silently dropped, not silently expanded into this PR.

**Files (gap-dependent, candidates):** `src/app/globals.css` /
`src/app/layout.tsx` (font), `src/components/ui/skeleton.tsx` (new),
`src/components/ui/button.tsx`, empty-state components, cover banner
component, block-handle component, plus
`tests/components/` specs per touched component.

**Coverage:** each shipped row gets a component-spec assertion (computed
style / class presence / rendered icon), and the PR body's
SHIPPED-or-GAP checklist is the coverage record for the whole sweep.

**Failure modes verified:**

- `prefers-reduced-motion` honored for U5 press-scale + any U3 transitions
  (a11y gate + explicit spec).
- Dark theme: token swaps (U2) asserted in both themes — the original audit
  row exists because raw Tailwind colors broke dark mode.
- No row regresses the axe CI gate (typography contrast, skeleton ARIA —
  skeletons get `aria-hidden` + the surface keeps an accessible busy state).
- Re-audit prevents the v0.9.18 class-3 failure (shipping "fixes" for things
  already fixed, masking what's actually broken): no row is implemented
  without a current-main GAP proof in the PR body.

## U1 re-audit outcome (2026-06-10): all 9 PATCH rows already shipped, no gap

Step-1 re-audit walked every extracted U-row against current `release/v0.9.19`.
**All 9 PATCH rows ship today** — three releases (v0.9.11→.14→.16→.18) absorbed
them — so per "ship only gaps" **no code change** was made. Evidence:

| U-row | Audit row | Item | Status | Proof (current `release/v0.9.19`) |
|-------|-----------|------|--------|-----------------------------------|
| U1 | 1 | Inter via `next/font` | ✅ SHIPPED | `src/app/layout.tsx:1,21` (`Inter({subsets,display:'swap',variable:'--font-inter'})`); `globals.css:256` stack leads with `var(--font-inter)` |
| U2 | 1 | Prose base + heading scale | ✅ SHIPPED | `globals.css:107-108` (`--cairn-prose-base:16px`/`--cairn-prose-leading:1.6`); `:183-187` `.ProseMirror h1{font-size:1.875rem;…letter-spacing:-0.01em}` |
| U3 | 3 | Status-color token swaps | ✅ SHIPPED | `editor.tsx:87-89` `bg-warning`/`bg-success` (no raw `bg-amber/emerald-500`); `suggestion-toolbar.tsx:123,130` `text-success`/`text-destructive` (no raw `text-green/red-700`) |
| U4 | 7 | Block-handle transition | ✅ SHIPPED | `drag-handle.tsx:101,111` `transition-colors duration-150` on both `+`/grip buttons |
| U5 | 8 | Page-cover hairline | ✅ SHIPPED | `globals.css:433` `.cairn-cover { … border-bottom: 1px solid hsl(var(--border)) }` |
| U6 | 10 | Button press-scale | ✅ SHIPPED | `ui/button.tsx:8` `active:scale-[0.98] motion-reduce:active:scale-100` |
| U7 | 11 | Empty-state icons | ✅ SHIPPED | `empty-state/variants.tsx` — `EmptySearch`→`Search`, `EmptyInbox`→`Inbox`, `EmptyBacklinks`→`Link2`, `EmptyRecents`→`Clock` (all `aria-hidden`) |
| U8 | 16 | Skeleton loaders | ✅ SHIPPED | `src/components/ui/skeleton.tsx` exists; applied in `search-palette.tsx`, `pages/cover-picker.tsx`, `notifications/drawer.tsx` (3 surfaces) |

Existing guards already cover these (component/source specs landed with the
original work). No new code, no new spec — this is the v0.9.18 class-3 lesson
(re-audit prevents re-shipping already-fixed work), same as the C1 outcome.

### Step-3 — remaining 20-point audit rows → v0.9.20 triage (NOT shipped here)

The non-PATCH rows from `plans/v0.9.11/polish-audit.md` are out of this item's
token/class scope and are listed (not silently dropped, not expanded into this
PR):

- **Row 5 — top-toolbar consolidation (REFACTOR):** the editor control strip
  (`editor.tsx`) and the page action bar (`page.tsx`) render as two stacked
  bars; folding the editor status/outline group into the page action bar is a
  structural refactor. Defer to v0.9.20.
- **Row 19 — settings double-sidebar (REFACTOR):** under `/settings` both the
  workspace `<Sidebar>` and the `SettingsSidebar` render (two left navs);
  hiding the workspace aside on settings routes is structural. Defer to v0.9.20.
- **Row 15 — search-palette mount fade-in (minor):** optional `animate-in
  fade-in-0 zoom-in-95` on the palette container. Cosmetic; defer.
