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
