# Audit retrospective — v0.9.10 live sweep (findings #113–#133)

Sweep of the v0.9.10 deployment surfacing flashcard breakage, residual UX gaps, and sidebar-density complaints. Items #113–#133. Triaged **against `main` (v0.9.10) source**, not the live env — which was **stale** (v0.9.9 crash-looped, v0.9.10 not yet deployed), so most "regressions" are stale-deploy, not code bugs.

## Headline
Of 21 reported items, **8 are genuine code bugs**; **13 are stale-deploy** (already correct in v0.9.10, resolve on redeploy). Plus a 20-point Notion-polish audit → see [polish-audit.md](polish-audit.md) (Plan U).

## Genuine code bugs → v0.9.11 scope
| # | P | Area | Issue |
|---|---|------|-------|
| #114 | P0 | Flashcards | Collab save path (`collab/server.ts materialize()`) bypasses `reconcileFlashcards` → cards never reach SRS. |
| #115 | P0 | Flashcards | `data-block-id=""` — no block-id mint on collab save (same knot as #114). |
| #116 | P1 | Flashcards | Study empty-state CTA links to `/` not a has-flashcards view. |
| #126 | P1 | Account | "Display name" label rendered twice. |
| #127 | P1 | Editor | Color control applies hardcoded red; no swatch popover. |
| #130 | P1 | Sidebar | Body text 14px/20px too loose → 13px/18px (a11y-safe text-size change; see scope Plan C). |
| #131 | P1 | Sidebar | Default width 256px → 224px. |
| #132 | P2 | Sidebar | Palette trigger 58px → trim (floored at 44px touch target). |

GH issues: #281 #282 #283 #284 #285 #287 #288 #289.

## Stale-deploy (verify after deploying v0.9.10) — tracker #286
#113 (flashcard NodeView), #117 (heading-collapse), #118 (suggestions diff), #119 (suggest chip click), #120 (notif matrix), #121 (/settings/admin redirect), #122 (draft default), #123 (see-also scoring), #124 (passkeys env gate), #125 (encryption copy), #128 (slash dismiss), #129 (semantic snippets), #133 (tree icons already 16px). All confirmed present in code.

## Lesson (recurring)
Same stale-deploy false-positive pattern as the v0.9.8 audit. The deployed image must be current before treating UI gaps as code bugs. The new e2e a11y gate + redeploy-first discipline are the structural fixes. Flashcards (#114/#115) are the one **real, never-deployed-working** defect — flashcards are a v0.9.0 feature untouched by v0.9.9, and the collab-save SRS gap predates all of it.
