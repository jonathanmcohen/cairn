# v0.9.8 Live Audit — Retrospective & v0.9.9 Backlog

**Audited build:** v0.9.8 live at `https://cairn.local.jonco.dev`
**Audit date:** 2026-06-02
**Findings:** 71 (waves 1–4). All filed as GitHub issues labeled `v0.9.9` (#185–250).
**Status:** Triage + filing complete. v0.9.9 NOT yet built — held for go/no-go.

---

## Executive summary

Four-wave functional + UI/UX sweep of the shipped v0.9.8 build surfaced 71 findings. Triage outcome:

- **1 P0** (#1 — `/settings/workspace/general` 500) + **1 P0-adjacent** (#38 — slash/mention parser leak = content corruption).
- **~14 P1** spanning nav surfaces, editor correctness, database depth, security UX, onboarding.
- **Remainder P2/P3** — polish, empty states, theme correctness, cover/icon, export, templates.
- **6 documented misreports** (verified working / mis-observed): #2, #3, #5 (sidebar hrefs correct in source — the apparent 404s trace to a **stale deploy**), #10 (aria-labels present; only hover tooltips missing), #11 (both buttons already `outline`).

### Root-cause theme: stale deploy
The P0 #1 500 is **missing migration 0054** (`workspaces.icon`, shipped v0.9.4) on the live DB — not a code regression. The same stale-deploy condition explains the #2/#3/#5 "broken sidebar routes": source hrefs are correct; the running container is behind. **First remediation is operational: redeploy `ghcr.io/jonathanmcohen/cairn:v0.9.8` and re-run the entrypoint migrator.** Code-hardening (#1: narrow select, `settings/error.tsx`, entrypoint fail-loud on pending migrations) prevents a single lagging column from 500-ing the whole page next time.

### Process lesson carried from v0.9.8
v0.9.8 CI thrashed because implementer subagents gated only their *touched* test files, letting pre-existing tests broken by their changes slip to CI. **v0.9.9 rule: every per-group gate runs the FULL `pnpm vitest run`.**

---

## Findings → issues by theme

### G1 — Critical (P0)
| # | Issue | Severity | Note |
|---|-------|----------|------|
| 1 | #185 | P0 | general 500 — narrow select + error.tsx + entrypoint fail-loud; root = missing migration 0054 (ops) |
| 38 | #217 | P0-adj | slash/mention raw text persists (content corruption); investigate parser-at-save vs renderer |

### G2 — Sidebar shell rebuild (cohesive group)
#207 sticky · #208 compact density · #209 flex-grow tree · #210 thin themed scrollbar · #211 overscroll-contain · #212 scroll-position affordance (P3) · #213 expand/collapse-all · ties to #237/#238/#239 (read/expand mode exit + sidebar reveal). All touch `sidebar-content.tsx` + `virtualized-page-tree.tsx` + `(app)` shell layout — rebuild together.

### G3 — Nav surfaces & taxonomy
#186 chat-bridge → `/settings/admin/chat-bridge` + redirects + dedupe (#4/6/7) · #187 export terminology (#8) · #202 Favorites sidebar entry (#23) · #196/#197 connectors rename + button labels (#17/18) · #203 quotas mint-token link (#24) · #225 invite modal/label (#46)

### G4 — Editor polish & content correctness
#188 locked-page tabs visible-disabled (#9, P1) · #189 toolbar tooltips (#10) · #190 submit-for-review variant (#11) · #205 backlinks snippet SQL (#26) · #214 cover backfill migration (#35, P1) · #218 inline-DB dead space (#39) · #219 see-also identical scores (#40) · #220 semantic snippets/scores (#41) · #232 suggestions diff preview (#53, P1) · #233 suggest-edits chip (#54) · #234 outline drawer (#55, P1) · #235 export consolidation + HTML/DOCX (#56) · #240 export shortcut (#61) · #245 /equation input affordance (#64, P1)

### G5 — Database depth (P1 cluster)
#241 row-detail panel (#62, largest item — row-as-page) · #242 property-type label case (#65) · #243 missing property types (#66 — Person/File/Email/Phone/Created-time/etc.) · #244 add-filter popover race (#67) · #246 row +/drag-handle position (#71)

### G6 — Security & notifications UX
#191 SSO button variants (#12) · #192 sessions UA-parse + real client IP (#13) · #193 encryption self-service copy + docs link (#14, P1) · #194 SMTP-disabled banner CTA (#15) · #195 notification event matrix + new types (#16, P1, migration)

### G7 — Theme correctness
#223 theme-toggle dead first-click (#44) · #224 light-mode regressions (#45, P1 — cover/approval-banner/inline-raw-text/code-blocks)

### G8 — Account, theming, cover/icon polish
#198 editable display name (#19) · #199 avatar upload (#20) · #200 theme live preview + 44px swatches (#21) · #201 theme hex shows current (#22) · #228 demote default-cover CTA (#49) · #229 gradient grid layout (#50) · #230 cover hex prefill (#51) · #231 icon-picker category tooltips (#52) · #236 cover click-to-edit (#60)

### G9 — Onboarding & empty states
#206 + #215 new-page naming + autofocus (#27/#36, P1) · #216 default Draft status (#37, P1, security-adjacent) · #221 bell flyout empty state (#42) · #222 trash/flashcards/favorites empty states (#43) · #204 favorites empty-state icon (#25) · #226 invite copy-link (#47) · #227 bell close-button contrast (#48, P3)

### G10 — Templates
#247 expand-state reset on navigation (#63) · #248 template preview drawer/thumbnail (#68) · #249 publish-to-web URL preview (#70) · #250 template card pill consolidation (#69)

---

## Misreports (verified working — no rebuild, documented in-issue)
- **#2 Trash retention** — sidebar already `/settings/workspace/trash` (label/slug mismatch confusion).
- **#3 Access tokens** — sidebar already `/settings/developer/tokens`.
- **#5 /settings/admin redirect** — already redirects to `/settings/admin/audit`, not members.
- **#10 toolbar labels** — `aria-label` present on all (SR-accessible); only hover `title`/Tooltip missing.
- **#11 button hierarchy** — submit-for-review AND export both already `variant="outline"`; export is not filled.

The #2/#3/#5 cluster is strong corroboration of the stale-deploy root cause.

---

## v0.9.9 release constraints (locked)
- Branch `patches/v0.9.9`, single PR, **no direct main landing**.
- **GitHub-hosted runners only** (no self-hosted) — avoids the OOM/SIGKILL flakes that plagued v0.9.7/v0.9.8.
- Biome **0 errors** gate; i18n keys (en/es/ar) for every new user-facing string.
- **Zero-deferral** — every filed issue resolves in v0.9.9.
- **Full `pnpm vitest run` in every per-group gate** (not just touched files).

## Anticipated migrations
- **0062** notification types (#195) · **0063** cover backfill (#214) · possibly **0064** avatar column (#199) · row-body content if #241 (row-detail) needs it.

## Screenshots
Live-audit screenshots referenced by the auditor are in the engagement thread; attach to individual issues as needed. (Placeholder — no screenshot URLs were provided to this doc.)

---

## Next step
Held for **go/no-go**. On GO: brainstorm the open design decisions (avatar scope, draft-default migration/back-compat, export HTML/DOCX library, row-detail data model, runner migration) → write spec → numbered plan suite → build subagent-driven, gated, single PR.
