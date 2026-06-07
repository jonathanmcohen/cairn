# v0.9.14 Scope — consolidated release

> # ⛔ HOLD — plan only. No code until explicit GO (per plan group).
> Branch `release/v0.9.14` · single PR at end · sequential plan gates with user GO between each · self-hosted runners (per standing call) · Biome 0 errors · i18n en/es/ar for new strings · full `pnpm vitest run` in every gate · e2e a11y gate. No migration expected in any plan (latest stays 0068).

## Plan-letter index + execution order

**Order: V → A → B → D → E → C → U** (test infra first so every fix lands under it; then P0 hotfixes; then editor/suggest/settings; density; polish). **Exception: A1 (#140 export 500) is P0 production-broken — may ship as a fast standalone hotfix ahead of V if the user prefers.**

| # | Plan | File | Severity | Theme |
|---|------|------|----------|-------|
| **V** | Test infrastructure split (lands first) | [plan-V-test-infrastructure.md](plan-V-test-infrastructure.md) | P2 infra | infra |
| **A** | Critical hotfixes (export 500, settings-general 500, Yjs↔API sync) | [plan-A-critical-hotfixes.md](plan-A-critical-hotfixes.md) | **P0** | regression |
| **B** | Editor block fixes (task-list, checkbox rename, heading collapse, slash leak, slash-behind-modal) | [plan-B-editor-block-fixes.md](plan-B-editor-block-fixes.md) | P1 | regression/feature |
| **D** | Suggest-edits drawer (inline diff, clickable chip) | [plan-D-suggest-edits-drawer.md](plan-D-suggest-edits-drawer.md) | P2 | feature |
| **E** | Notifications + settings (event matrix, passkeys copy, encryption copy, admin→audit) | [plan-E-notifications-settings.md](plan-E-notifications-settings.md) | P2 | polish/feature |
| **C** | UI density polish (sidebar width, editor block spacing, default Draft, cover overlay) | [plan-C-ui-density-polish.md](plan-C-ui-density-polish.md) | P2 | polish |
| **U** | Notion polish pass (20-point audit) | [plan-U-notion-polish.md](plan-U-notion-polish.md) | P3 | polish |

Supporting docs: [polish-audit.md](polish-audit.md) · [audit-v0.9.13-retrospective.md](audit-v0.9.13-retrospective.md) · [postmortem-export-500.md](postmortem-export-500.md)

## Plan → item map

- **A — Critical hotfixes (P0):** A1 #140 export ALL formats 500 · A2 #1 `/settings/workspace/general` 500 · A3 Yjs/collab ↔ API content-write precedence.
- **B — Editor block fixes:** B1 #138 task-list flex layout · B2 #139 rename "Task list"→"Checkbox list" · B3 #117 heading-collapse chevron · B4 #76 slash leak after modal cancel · B5 #128/#136 slash menu behind modal.
- **C — UI density:** C1 sidebar width 256→240 · C2 sidebar text 13px verify (Study label) · C3 #141 editor block spacing · C4 new-page default Draft (K2) · C5 cover gradient overlay legibility.
- **D — Suggest edits:** D1 #118 inline diff in cards · D2 #119 whole-chip clickable→scroll+select.
- **E — Notifications/settings:** E1 #16 notification event-matrix expansion · E2 #89 passkeys admin/user copy split · E3 encryption-off heading copy · E4 #5 `/settings/admin`→`/audit`.
- **U — Notion polish:** the 20-point audit (see polish-audit.md).
- **V — Test infra:** `tests/{blocks,database,api,collab,workflow,settings,ui,e2e}` + CI matrix + per-feature/per-block/per-endpoint specs + backfill for every fix here + `tests/README.md`.

## Carry-forward context (already analysed / proven)

- **A1 #140 — root cause PROVEN** (see postmortem): export route statically `import { chromium } from '@playwright/test'` via `pdf-native.ts`; `next build` standalone omits `playwright-core/browsers.json` → module-load crash → generic 500 for **every** format incl md/json. Fix = lazy `await import('@playwright/test')` inside `pageToPdf` (env-gated `CAIRN_NATIVE_PDF`). Build-graph guard test prevents recurrence.
- **B1 #138** — confirmed NO task-list/checkbox CSS exists; `<li data-checked>` stacks checkbox above text. Fix = `ul[data-type='taskList'] li { display:flex; align-items:baseline }` in `blocks.css`.
- **B2 #139** — `slash-extension.ts:425` `title:'Task list'`; rename → "Checkbox list", keep `task` keyword alias; My-tasks stays @-mention aggregation; document distinction.
- **B4/B5 #76/#136/#128** — citation/footnote slash items don't `consumeSlashRange` before opening dialog and never `popup.destroy()`; flashcard already destroys. (Note: v0.9.13 Plan A *already fixed* the citation/footnote popup for #76/#136 — VERIFY whether these still reproduce on v0.9.13; if fixed, B4/B5 may reduce to equation-modal only + a regression test.)
- **C1** width — fallback already `14rem`/224 (v0.9.11 #131); 240 is a re-tune (Notion=240). Persisted drag overrides either way.
- **C3 #141** — selector is `.ProseMirror` (editor.tsx:103), NOT `.tiptap.prose`; merge margins into the existing v0.9.13 `.ProseMirror h1/h2/h3` block.
- **D1/D2 #118/#119** — v0.9.13 already shipped diff-preview rendering (#118) AND clickable suggestion card (#119, content-button pattern). **VERIFY these still need work**; likely already done — B/D may shrink to regression tests + live-confirm.
- **E4 #5** — v0.9.11/earlier already redirect `/settings/admin`→`/audit` (stale-deploy item #121). VERIFY on v0.9.13; likely no-op.
- **A2 #1** — settings-general is UX-wrapped with a themed error card; needs runtime repro to find the real loader 500 (systematic-debugging).
- **A3** — collab uses raw `postgres` driver; `materialize()` writes `pages.content`; REST PATCH also writes `pages.content` + (v0.9.11) reconciles flashcards. The Yjs doc in the Hocuspocus process is authoritative for an open editor → an API PATCH to `pages.content` is overwritten on next materialize. Decide precedence: (a) API write publishes through Hocuspocus, (b) API write signals Yjs invalidation, or (c) document "editor (Yjs) wins while open; API writes land when no active doc." Lowest-risk for a patch = **(c) document + add a regression test asserting the precedence**, defer (a)/(b) to a feature release.

## Re-verify-before-build (v0.9.8 lesson — several may already be fixed on v0.9.13)
#76, #136, #128 (B4/B5), #118, #119 (D1/D2), #5 (E4), #117 (B3 present-but-hover) — code-check each at plan time; downgrade to "regression test only" if already implemented. Don't rebuild shipped work.

## Standing carryover
#286 deploy v0.9.13 + clear 12 stale items · CI runner debt (self-hosted 2-runner queue) · v0.9.13 VERIFY-LIVE #117/#118/#58.
