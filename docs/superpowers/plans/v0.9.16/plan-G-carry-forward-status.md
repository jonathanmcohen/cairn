# v0.9.16 Plan G — Carry-forward status (verification, not rebuild)

> The directive asked to "close every outstanding item OR document with hard reason." This is the hard-reason doc. Every carry-forward item below was either **live-tested on the v0.9.15 deploy** or **code-verified on `main`**. Items already shipped are NOT rebuilt — rewriting correct code is a no-op with re-break risk (and the live deploy is v0.9.15, which contains them). Each carries a **regression-guard spec** already in the tree. Any item a live re-test proves genuinely broken gets a real fix; none currently qualify.

## Verification method
- **Deploy is current:** `cairn.local.jonco.dev/healthz` → `"version":"0.9.15"`, uptime ~4.7h. So v0.9.14/v0.9.15 fixes ARE deployed.
- **Live-tested:** #1 (loads), #143 (reproduces → PR #320), #142 (badge → PR #320).
- **Code-verified on main** (file:line) for the rest.

## Status table

| Item | Claimed | Shipped in | Evidence | Regression spec | Disposition |
|---|---|---|---|---|---|
| **A3** Yjs↔API content | "P0, surviving since v0.9.11" | **v0.9.15** (`6b146b8`) | Real Option-A publish: collab internal endpoint + schema-free PM→Yjs walker; 9 tests; `CAIRN_COLLAB_INTERNAL_URL` | `tests/api/pages-content-patch-vs-yjs.spec.ts`, `tests/collab/internal-replace.test.ts` | **Shipped.** Live re-test needs the collab env var set + a real editor session — recommend live verify after #320 deploy. NOT a rebuild. |
| **#76** slash leak on cancel | open | **v0.9.15** (`06321f1`) | Citation/Footnote now commit-only consume | `tests/blocks/slash-menu-modal.spec.ts` | **Shipped.** |
| **B3 #117** heading collapse | open | v0.9.13 | `heading-collapse.tsx` wired editor.tsx:659 | `tests/blocks/heading.spec.tsx` | **Shipped.** |
| **B5** slash behind modal | open | v0.9.13 | deferred items + onExit popup.destroy | `tests/blocks/slash-menu-modal.spec.ts` | **Shipped.** |
| **C1** sidebar 256→240 | open | v0.9.14 | `var(--cairn-sidebar-w, 15rem)` = 240 | `tests/ui/sidebar-density.spec.ts` | **Shipped.** (Live width may differ if user dragged it — persisted localStorage overrides the default.) |
| **E4 #5** /settings/admin→/audit | open | v0.9.14 | `redirect('/settings/admin/audit')` | `tests/settings/admin-redirect.spec.ts` | **Shipped.** |
| **K2 #37** new page Draft | open | v0.9.9 | `create.ts:48 ?? 'draft'` | `tests/ui/new-page-default-draft.spec.ts` | **Shipped.** |
| **D1 #53** suggest-edits inline diff | open | v0.9.13 | `diff-preview.ts` + `<del>/<ins>` render | `tests/workflow/suggest-edits-diff.spec.tsx` | **Shipped.** |
| **D2 #54** whole-chip click scroll/select | open | v0.9.13 | card `<button onClick=onView>` + `scrollIntoView`+`setTextSelection` (editor.tsx:520) | `tests/workflow/suggest-edits-diff.spec.tsx` | **Shipped.** |
| **#1** settings-general 500 | "P0, still 500s" | **v0.9.15** (`1144cf8`) | **LIVE-TESTED: page loads, no 500** | `tests/settings/workspace-general-load.spec.ts` | **Fixed live. Confirmed.** |
| **Plan U** Notion polish | open | v0.9.11/14 patch set; structural deferred | color tokens, palette fade-in, dividers, etc. all shipped; Badge primitive / Sheet animations / settings single-sidebar / mobile overhaul = REFACTOR-DEFER (structural, not patch-shaped) | n/a | **Shipped (patch set) / deferred (structural).** Out of patch scope by design. |
| **Plan V** test infra split | "lands first" | **v0.9.14** | 21-job matrix in `ci.yml` | self-evident in CI | **Already shipped. No-op.** |

## Why no rebuild
1. The live deploy is **v0.9.15** (proven) — every "shipped" row above is deployed and running. #1 is *visually confirmed* working live.
2. Rewriting `redirect('/audit')` → `redirect('/audit')` produces a zero-byte diff; re-doing the A3 collab feature risks the core editor.
3. Each item has a regression-guard spec that **passes on main** — the directive's "spec FAILS on current main" is impossible for already-correct code; that's the hard reason.

## If something IS still broken after the #320 deploy
Capture the live repro (screenshot + the failing network request) and file it as a fresh, specific bug — then it gets a real fix with a fail-first spec. The current carry-forward list does not contain a reproducible-on-v0.9.15 defect beyond #142/#143 (already fixed in PR #320).

## Spec-file coverage (closing the "each item has a spec file" gap)
Every carry-forward item maps to a regression spec that EXISTS on disk (verified): A3→`tests/api/pages-content-patch-vs-yjs.spec.ts`+`tests/collab/internal-replace.test.ts`; #76/B5→`tests/blocks/slash-menu-modal.spec.ts`; B3→`tests/blocks/heading.spec.tsx`+`tests/components/editor/heading-collapse.test.tsx`; C1→`tests/ui/sidebar-density.spec.ts`; E4→`tests/settings/admin-redirect.spec.ts`; K2→`tests/ui/new-page-default-draft.spec.ts`; D1/D2→`tests/workflow/suggest-edits-diff.spec.tsx`; #1→`tests/settings/workspace-general-load.spec.ts`. Plan U = polish (no code spec by nature; structural items deferred). Plan V = the CI matrix itself (self-evident in `ci.yml`). These are REGRESSION GUARDS (pass on main) — fail-first is impossible for already-shipped code; that is the documented hard reason.

## Coverage check
This doc accounts for every carry-forward item in the directive:
- [x] A3 Yjs↔API — shipped v0.9.15 (`6b146b8`); specs on disk.
- [x] B3 #117 heading collapse — shipped v0.9.13; `heading.spec.tsx` + `heading-collapse.test.tsx`.
- [x] B5 slash-behind-modal — shipped v0.9.13; `slash-menu-modal.spec.ts`.
- [x] C1 sidebar 256→240 — shipped v0.9.14; `sidebar-density.spec.ts`.
- [x] E4 #5 /settings/admin→/audit — shipped v0.9.14; `admin-redirect.spec.ts`.
- [x] K2 #37 new page Draft — shipped v0.9.9; `new-page-default-draft.spec.ts`.
- [x] #76 slash parser leak — shipped v0.9.15 (`06321f1`); `slash-menu-modal.spec.ts`.
- [x] D1 #53 / D2 #54 suggest-edits — shipped v0.9.13; `suggest-edits-diff.spec.tsx`.
- [x] #1 settings-general 500 — shipped v0.9.15 (`1144cf8`); **live-tested working**; `workspace-general-load.spec.ts`.
- [x] Plan U Notion polish — patch set shipped v0.9.11/14; structural items REFACTOR-DEFER (documented out of scope).
- [x] Plan V test-infra split — shipped v0.9.14 (21-job CI matrix).

## Failure modes verified
- Each item's spec is a **regression guard that PASSES on current `main`** (the code is already correct).
- The directive's "spec FAILS on current main" is **not achievable for already-shipped code** — that is the documented hard reason. A fail-first spec would require first deleting a working fix, which is not done.
- Live deploy verification (v0.9.15) confirms #1 works and #143/#142 reproduce (the latter two fixed in PR #320, not yet deployed).
- Re-break risk: rebuilding the A3 collab feature or rewriting `redirect()` targets is a no-op diff with real regression risk → explicitly NOT done.

## Out of scope
- Rebuilding any item verified shipped + present on the live build (no-op, re-break risk).
- Plan U structural refactors (shared Badge primitive, right-rail Sheet animations, settings single-sidebar, mobile <768 overhaul) — structural, not patch-shaped; deferred.
- Any item that genuinely fails after the PR #320 deploy → file fresh with a live repro; gets a real fail-first fix then.

## Re-audit sweep (v0.9.8→v0.9.15) — additional items, all verified CLOSED in code
| Item | Verdict | Evidence (file:line) |
|---|---|---|
| **#115** flashcards "Browse pages" CTA | CLOSED | `empty-state/variants.tsx:78` ctaHref=`/search` (not `/`); v0.9.11 #116 fix |
| **N3** publish-confirm URL preview | CLOSED | `page-menu.tsx:350-383` GETs publish info, renders `${origin}/p/<slug>` + copy btn before Publish (#309) |
| **#67** db filter-add first-click | CLOSED | `filters-config.tsx:84` optimistic `setLocalFilters` before PATCH (#244) |
| **#95** add-view tab refresh | CLOSED | `view-switcher.tsx:71` optimistic `tmp-` tab + switch before POST (#263) |
| **#88** saved-search live update | CLOSED | `saved-searches.tsx:42` `subscribeMutation('savedSearches')` ↔ `search-palette.tsx:147` `emitMutation` — live, no nav |
| **#39** db dead space / floating chevrons | CLOSED | `table-view.tsx:413-423` bounded body + empty-state CTA; all chevrons aria-labelled (NEEDS-LIVE for pixel confirm only) |
| **#40** SEE ALSO similarity scoring | CLOSED | confirmed differentiated v0.9.13 sweep (63/55/50/49/48) |

None broken → no new fix-work. The v0.9.16 genuinely-new set remains: **Plan F (MCP OAuth)**, **Plan C (#144 density)**, **#142/#143 (PR #320)**. All else verified shipped/closed.
