# v0.10.2 — UI/sidebar polish + flashcards management

> **HOLD: do not touch code until the user replies GO on Plan B.** Scaffold only.

Single release, single tag, single image (user decision 2026-06-12: **no
deferrals** — flashcards phases F2 and F3 land in v0.10.2 itself, not
v0.10.3/v0.10.4). **35 items locked across 4 plans. Zero deferred.** (P6 later closed
mid-release — superseded by P1 deleting its target surface; 34 build items
remain. Recorded in plan-P.)

## Re-audit outcome (2026-06-12)

All 37 seeded items + the flashcards foundation were re-audited against repo
evidence (file:line) before locking — 38 verdicts. **5 closed at audit time**
(already shipped or premise-wrong). The audit also surfaced premise
corrections on 14 more items; the corrected facts are baked into the plan
docs so no item rebuilds something that exists.

### Closed by re-audit — no work (5)

| Item | Verdict |
|------|---------|
| P3 | **Both premises wrong.** Palette rows are ~36px (`px-4 py-2 text-sm`, `search-palette.tsx:270`), not 44px; no footer hint chips exist to clip (footer is one Save-search button, `:377-389`); the `max-w-lg` palette is unconstrained at 800px. |
| P8 | **Paragraphs already get block handles.** `p` is in the DragHandle closest() selector (`drag-handle.tsx:33-35`), as are blockquote/pre/hr/callout/images/files/node-views. |
| S12 | **The "device icon" is the ThemeToggle** (`sidebar-footer-nav.tsx:120`, `theme-toggle.tsx:28-30` — Monitor renders in system mode). It already has aria-label + title ("Switch theme"). Not a Devices link; removing it would remove theme switching. |
| S13 | **Version chip substance shipped** (E2): button opens the in-app WhatsNewPanel with localStorage unread dot (`sidebar-footer-nav.tsx:126-142`, `whats-new/storage.ts:15-24`). Residual underline→pill restyle is folded into the S17 footer PR, not a standalone item. |
| S16 | **Two-pane scroll already exists.** Upper sections capped `max-h-[45%]` with own scrollbar (`sidebar-content.tsx:68-74`), tree owns its scroll (`virtualized-page-tree.tsx:186`), footer nav sits outside both — pinned at any tree size. |

### In scope (35) — plan letters

| Plan | Items | Theme |
|------|-------|-------|
| **B** (2) | B1 template-clone stranded button (root-caused: database-kind `instantiateTemplate` never returns the minted host-page id → gallery `busy` never resets; NOT an 8s hang — sticks forever) · B2 trash "Untitled" fallback (no fallback anywhere in the chain; icon claim corrected in plan) | Carry-forward bugs |
| **P** (15 after the P6 supersession) | P1 header de-clutter · P2 block spacing (audit-corrected actual values in plan) · P4 status pill colors · P5 citation chip · P6 zero-count chip dim (CLOSED mid-release: superseded by P1) · P7 collapse chevron rest-opacity · P9 slash category rail · P10 admin nav grouping (15 actual entries — bucket map for ALL in plan, unlisted ones flagged for GO) · P11 settings nav icons · P12 sync-warning surfacing · P13 encryption banner tone · P14 gallery polish (depends B1) · P15 notification footer empty state · P16 switcher dropdown width · P17 404 search · P18 indexing indicator | UI polish |
| **S** (14) | S1 collapse+resize (resize partially exists) · S2 density pref (actual current row 26px — plan corrects) · S3 dividers · S4 section headers · S5 hover action icons · S6 switcher chip letter fallback · S7 search pill label · S8 tree polish (6 sub-items) · S9 hub badges · S10 slot diet · S11 sign-out confirm (#80) · S14 footer Live indicator · S15 empty states · S17 slot reorder | Sidebar overhaul |
| **F** (3) | F1 manage + orphans + migration 0076 + sidebar Flashcards parent + backup integration · F2 decks (migration 0077, tree, per-deck options, block deck picker + canonical-card inversion) · F3 stats + heatmap + .apkg export + Settings → Workspace → Flashcards (migration 0078) | Flashcards management |

### Deferred past v0.10.2

**Nothing.**

## Order (locked)

1. **Plan B** — bugs land first (B1 unblocks P14).
2. **Plan P** — UI polish (B/P sub-batches may ship as one rolling release).
3. **Plan S** — sidebar overhaul. **Sequencing rule:** F1's sidebar
   Flashcards parent supersedes the two flashcard rows — S9/S17 land with
   those rows carved out, or after F1's sidebar PR (resolution stated in
   whichever PR merges second).
4. **Plan F** — F1 → F2 → F3, strictly ordered (F2's migration is additive
   on F1's; F3's stats read F1's `reps` + audit rows).
5. Version bump + CHANGELOG → `v0.10.2-rc1` → user verifies live → final tag.

Migrations land in **F1 (0076 flashcards manage: decks-minimal, deck_id,
source_orphaned_at, tags, suspended_at, reps, page_id FK CASCADE→SET NULL),
F2 (0077 decks full entity), F3 (0078 review_events +
workspace_flashcard_settings)** — plus S2 only if the density pref becomes a
column rather than reusing the existing theme-prefs store. Every migration
backfills existing rows where behavior changes (the A3 lesson).

## Gates (inherited from v0.10.0, unchanged)

One PR per item off `release/v0.10.2` (branch
`release/v0.10.2-item-<id>-<slug>`). Every PR description MUST include, or
the tag does not happen:

1. **Spec file path** under `tests/e2e/` (or the layer that catches the bug,
   with justification — Plan F's migration integration tests and the .apkg
   binary-format unit test are the pre-justified exceptions).
2. **Spec output on main BEFORE the fix** — pasted, RED for fix PRs (guards
   state "guard — no before"; no fabricated befores).
3. **Spec output on branch AFTER the fix** — pasted, GREEN (×3 for e2e).
4. **Live-deploy verification** — navigate the repro path on the booted
   preview deployment, screenshot committed under
   `docs/superpowers/v0.10.2/artifacts/`.

UI-wiring specs drive the real browser surface through the proxy
(handler-import tests don't count). i18n gate on every PR adding UI text:
keys in `messages/{en,es,ar}.json`, no hardcoded JSX strings (CI bans them).
e2e hygiene: unique per-run fixture strings (persistent dev DB), no
off-screen dropdown clicks, `--list` the spec args before trusting a run.

## Reporting (verbatim strings)

- Per PR merge: `ITEM <id> MERGED to release/v0.10.2 — spec output + screenshot attached.`
- RC ready: `v0.10.2-rc1 IMAGE READY — pull and verify.`
- After user VERIFIED: `v0.10.2 SHIPPED — image at ghcr.io/jonathanmcohen/cairn:v0.10.2.`

## Plan docs

- [plan-B-carry-forward.md](plan-B-carry-forward.md) — 2 items
- [plan-P-ui-polish.md](plan-P-ui-polish.md) — 16 items (+2 closed)
- [plan-S-sidebar-polish.md](plan-S-sidebar-polish.md) — 14 items (+3 closed)
- [plan-F-flashcards.md](plan-F-flashcards.md) — 3 phases, all in-release
