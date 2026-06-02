# v0.9.8 Live Audit — Retrospective & v0.9.9 Backlog

**Audited build:** v0.9.8 live at `https://cairn.local.jonco.dev`
**Audit date:** 2026-06-02
**Findings:** 99 (waves 1–7). All filed as GitHub issues labeled `v0.9.9` (#185–270).
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
| 80 | #251 | **P0** | **Sign out broken (security)** — `sidebar-footer-nav.tsx:50` posts CSRF-less to `/api/auth/signout`; Auth.js v5 rejects it; exported `signOut()` server action (config.ts:220) never invoked; no `/logout` route. Confirmed real source bug (task #213 left it incomplete). Fix: wire `signOut()` server action OR client `signOut()` from next-auth/react. Same defect duplicated in `sessions-card.tsx:121`. |
| 72 | #252 | **P0** | **Comment mentions render raw markdown** — `comment-panel.tsx:189` renders `{comment.body}` raw; `@[Name](uuid)` storage token never parsed to a pill on the read path (only `extractMentions` for notifications). Editor has `renderHTML`; comments don't use it. Fix: mention parse-and-render util on comment bodies. |
| 76/77 | #254 | **P0** | **Slash parser systematic breakage** (supersedes #38/#217) — `slash-extension.ts:786` `command` does synchronous unconditional `deleteRange(range)` then fires an often-async/early-returning `props.command` (dialog cancel, lazy-load). In non-paragraph blocks (H1) the range doesn't bound the `/` trigger → stray char + merged text; on cancel nothing inserts but text already deleted → lone `/`. No `preventDefault` on Enter (slash-menu.tsx:112). Fix: restore-on-cancel + range that includes trigger + guard Enter. |
| 38 | #217 | P0-adj | slash/mention raw text persists (content corruption) — root-caused by #254. |

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

### Wave-5 additions (comments / webhooks / auth)
#251 sign-out P0 (#80) · #252 comment mention render P0 (#72) · #253 comment trailing-text dropped on @-pick — write-path P1 (#73) · #254 slash parser systematic P0 (#76/#77) · #255 comment Edit affordance (#74) · #256 version-history save refetch (#75) · #257 webhook event list incomplete vs audit log (#78) · #258 webhook select-all/recommended (#79).
**Verified working (no issue):** #81 `/login` redirects authed users ✅ · #82 mention-picker autocomplete + inline trigger hints ✅.

**Investigator confirmed #72/#80 are real source P0s (not stale-deploy); #73 root cause is the comment write/serialization path, not the composer (composer caret/insert is correct).**

### Wave-6 additions (editor markdown / audit log / ACL surfacing)
#259 per-page ACL panel unreachable — **backend SHIPPED** (page_acls migration 0057 + acl.ts + `PageAclManager` built v0.9.8 G20, mounts in share-panel.tsx) but not wired into the page ⋯ menu; just surface it, NOT a missing feature (#94, P1) · #260 `**bold**` markers not stripped (#83, P1) · #261 strikethrough shortcut unsupported (#84) · #262 CSS `quotes` bleeds curly quotes onto blockquote+li (#86, P1 visible corruption) · #263 gallery add-view no-op (#95, cf #67/#244 popover race) · #264 add-view Calendar/Timeline/Board grayed unexplained (#87) · #265 audit-log Actor/Target raw IDs not resolved (#91/#92) · #266 saved-search sidebar no live-update (#88) · #267 passkeys page leaks operator env-var names to all users (#89) · #268 docs/operations.md plain path not link (#90, P3) · #269 audit-log expand button on empty metadata (#93, P3).
**Verified working (no issue):** #85 `*italic*`/`` `code` `` markdown shortcuts clean ✅.

### Wave-7 additions (final)
#270 page-review Approve → raw "Decision failed (409)", no actionable copy (#96, P1 — likely self-approval or stale-state conflict; map 409 to friendly message) · **#95-revised** folded into #263 (gallery add-view DOES create the view; real bug is the tabs row not refreshing on add — refetch/optimistic-insert, same class as #266/#75).
**Verified working (no issue):** #97 code-block language picker (searchable, Auto-detect/Plain/TS/TSX/JS/JSX) ✅ · #98 code-block copy icon (hover, well-placed) ✅. #99 bibliography `0` badge click — **untestable** (0 citations on test page; retest with populated citations).

### Refetch-gap cluster (cross-cutting pattern)
Multiple findings share one root: server-rendered or list surfaces not re-fetching after a mutation (app uses `router.refresh()`, not TanStack). Members: #266 saved-search sidebar, #75 version-history snapshot, #263 gallery add-view tabs, plus the v0.9.8 #178 family. **Worth a single shared fix pass** (audit every mutation for a refresh/optimistic-insert) rather than scattered one-offs.

### Consolidated P0 list (go/no-go priority order)
1. **#251 sign-out broken** (security — users cannot log out; CSRF-less POST, `signOut()` action never invoked).
2. **#185 general-500** (ops-rooted: missing migration 0054; fix = redeploy+migrate, code-harden prevents recurrence). Same root explains the #2/#3/#5 "broken sidebar route" misreports (hrefs correct in source).
3. **#254 slash parser** (#38/#76/#77 — systematic; sync deleteRange + async/early-return command).
4. **#252 comment mention renders raw markdown** (read-path missing parser).
5. **#259 per-page ACL** — only P0-if-feature-gap; **it is NOT** — backend + component shipped, just surface from ⋯ menu (downgraded to P1).

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
