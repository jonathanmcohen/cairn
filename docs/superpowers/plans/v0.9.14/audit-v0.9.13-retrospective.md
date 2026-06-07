# v0.9.13 Retrospective — sweep findings feeding v0.9.14

Every finding from the post-v0.9.12 / v0.9.13 browser sweeps + code-checks, numbered, with severity and disposition into a v0.9.14 plan. Severity: P0 broken-in-prod · P1 visible defect · P2 polish/UX · P3 nice-to-have.

## Regressions / bugs

| # | Issue | Severity | Finding | Disposition |
|---|-------|----------|---------|-------------|
| R1 | #140 export 500 (all formats) | **P0** | Top-level `@playwright/test` import in `pdf-native.ts` crashes standalone route load. Root cause proven. | Plan A1 |
| R2 | #1 `/settings/workspace/general` 500 | P1 | Themed error card shown; real loader cause needs runtime repro. | Plan A2 |
| R3 | Yjs ↔ API content races | P1 | API PATCH to `pages.content` overwritten by next Hocuspocus materialize while editor open. Architectural. | Plan A3 (document + regression; full publish deferred) |
| R4 | #138 task-list layout | P1 | No `taskList` CSS at all — checkbox stacks above text. Confirmed ABSENT in `blocks.css`. | Plan B1 |
| R5 | #139 "Task list" naming | P2 | Slash item titled "Task list" collides conceptually with My-tasks aggregation; should read "Checkbox list". `slash-extension.ts:425`. | Plan B2 |

## Already-shipped on v0.9.13 (downgraded to regression-test-only)

| # | Issue | Severity | v0.9.13 state (verified in code) | Disposition |
|---|-------|----------|----------------------------------|-------------|
| S1 | #117 heading collapse chevron | P2 | `heading-collapse.tsx` implemented + wired at `editor.tsx:659`, i18n all 3 locales, tested. | Plan B3 — regression test only |
| S2 | #76 slash range leak on cancel | P1 | Modal slash items are `deferred:true`; `onExit`→`popup.destroy()` fires before modal opens; covered by `slash-modal-consistency.test.ts`. | Plan B4 — regression test only |
| S3 | #128/#136 slash menu behind modal | P1 | Same destroy-on-exit mechanism; popup gone before modal. | Plan B5 — regression test only |
| S4 | #118 inline diff in suggestion cards | P2 | `diff-preview.ts` + `<del>/<ins>` render in `suggestions-drawer.tsx`, unit+component tested. | Plan D1 — regression test only |
| S5 | #119 whole-chip clickable + scroll/select | P2 | Card content is `<button onClick=onView>`; `viewSuggestion()` does `scrollIntoView` + `posAtDOM` + `setTextSelection`. | Plan D2 — regression test only |
| S6 | #16 notification event matrix | P2 | `page_approval`/`page_status`/`page_lock` already in `NotificationType` enum + prefs matrix. | Plan E1 — regression test only |
| S7 | #89 passkeys admin/user copy | P2 | `PasskeysNotConfigured` gates `adminBody`/`userBody` via `isAdmin`; env names never shown to users. | Plan E2 — regression test only |
| S8 | #5 `/settings/admin` redirect | P2 | `redirect('/settings/admin/audit')` confirmed. | Plan E4 — regression test only |
| S9 | C2 sidebar 13px / Study label | P2 | StudyLink carries density triplet; `sidebar-density-study-link.test.tsx` covers it. | Plan C2 — regression confirm only |
| S10 | C4 new-page default Draft | P2 | `create.ts:48` `ws?.defaultPageStatus ?? 'draft'` since K2. | Plan C4 — regression test only |

## Still-needs-fix polish

| # | Issue | Severity | Finding | Disposition |
|---|-------|----------|---------|-------------|
| P1 | #141 editor block spacing | P2 | `.ProseMirror` has font rules but zero margin rules → blocks too loose. | Plan C3 |
| P2 | #1 sidebar width re-tune | P2 | Fallback `14rem`/224; Notion uses 240. Optional re-tune (persisted drag overrides). | Plan C1 |
| P3 | E3 encryption-off heading | P2 | `E2EEnrollCard` disabled branch still shows "Set up your encryption key" h2. Misleading when E2EE off. | Plan E3 (only code change in Plan E) |
| P4 | C5 cover overlay legibility | P3 | Title is a DOM sibling BELOW cover, never overlaid → no scrim needed. | Plan C5 — no-op (documented) |
| P5 | Notion 20-point polish | P3 | Most PATCH items shipped v0.9.11/v0.9.13; remaining = color-token survivors + cover hairline + palette fade-in. Badge primitive / Sheet animations / settings single-sidebar = structural, deferred. | Plan U |

## Infra

| # | Item | Severity | Finding | Disposition |
|---|------|----------|---------|-------------|
| I1 | Monolithic test run | P2 | 978 files in one serial vitest job; no per-feature signal. Lighter path = matrix over existing top-level dirs (not 978-file reorg). | Plan V |
| I2 | `.spec.ts` not collected | P2 | vitest `include` is `*.test.{ts,tsx}` only; new spec stubs won't run until glob widened. | Plan V (config edit) |

## Standing carryover (not v0.9.14 plan items)
- #286 deploy `v0.9.13` image + clear 12 stale-deploy items (several "not shipped" were actually present — re-verify live, not by browser-trust).
- CI runner debt: 2 self-hosted runners serialize the matrix 2-at-a-time (log localization wins; wall-clock may not).
