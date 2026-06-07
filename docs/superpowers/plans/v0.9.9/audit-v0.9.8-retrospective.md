# v0.9.8 Live Audit — Retrospective & v0.9.9 Backlog

**Audited build:** v0.9.8 live at `https://cairn.local.jonco.dev`
**Audit date:** 2026-06-02
**Findings:** 112 (waves 1–9). All filed as GitHub issues labeled `v0.9.9` (#185–277).
**Status:** Triage + filing complete. AUDIT CLOSED. v0.9.9 NOT yet built — held for go/no-go.

---

## ⚠️ Regressions & unfulfilled prior scope (READ FIRST)

Cross-referencing the 112 findings against promised scope in v0.7.0 / v0.9.6 / v0.9.7 / v0.9.8 shows a **systemic pattern: checklist-completed scope shipped without UI acceptance-testing the surface that ties it together.** 12 findings trace to features marked "done" in earlier releases. All retitled `[REGRESSION vX]` + labeled `regression`; they lead v0.9.9.

| Issue | Finding | Promised in | What broke |
|-------|---------|-------------|------------|
| **#251** | #80 sign out broken | **v0.1.0** | **Auth's most basic action — broken across ~16 releases. CSRF-less POST; `signOut()` action never invoked. P0 security.** |
| **#252** | #72 comment renders raw `@[Jon](uuid)` | v0.3.0 | mention render pipeline never applied to comment bodies |
| **#254** | #38/76/77/111/112 slash parser | **v0.9.6** | v0.9.6 spec explicitly listed "citation/file slash insert silent" as a fix; still silent across /equation /citation /mermaid /embed /bookmark **and now corrupts persisted block hierarchy** (stray char → heading → /toc) |
| **#259** | #94 per-page permissions UI | **v0.7.0 headline** | one of 12 v0.7.0 features; backend shipped (`page_acls` migration 0057 + `PageAclManager` component) but **UI never wired to the ⋯ menu** — `/pages/:id/permissions` + `/share` 404 |
| **#264** | #87 DB add-view grayed | v0.9.6 | v0.9.6 promised "add-view tooltips + icons + empty-state CTA"; disabled types still unannotated |
| **#189** | #10 toolbar no tooltips | v0.9.7 | v0.9.7 added WCAG AA labels to automation builder — same bar not applied to page-editor toolbar |
| **#190** | #11 submit-for-review hierarchy | v0.9.7 | review workflow shipped; button-weight polish gap |
| **#266** | #88 saved-search sidebar | v0.9.7 | saved searches shipped; sidebar live-refresh missing |
| **#188** | #9 lock hides biblio tabs | v0.9.6×v0.9.8 | lock (v0.9.6) × Bibliography (v0.9.8) interaction never regression-tested |
| **#256** | #75 version drawer no refetch | v0.5.0 | version history shipped v0.5.0; drawer refetch-on-save missing |
| **#185** | #1 general-500 | pre-0.9.x | hard regression (also stale-deploy: missing migration 0054) |
| **#214** | #35 orange covers not backfilled | v0.9.8 | palette shipped without a backfill migration |

**Root-cause pattern:** features land backend-first or component-first, marked complete on the plan checklist, but the end-to-end UI surface (route reachable? button wired? render path applied? prior feature still works alongside the new one?) is never click-tested on a deployed image. The stale-deploy cluster (#185/#2/#3/#5) compounds it — even correct fixes weren't verified live.

**RECOMMENDATION — add an "end-to-end UI acceptance" gate before any v0.9.9 ship:** a literal click-through of every URL slug + every promised feature on the **deployed image** (not just `pnpm build` + unit tests). Concretely: a Playwright smoke that visits every route in the sidebar + settings nav and asserts 200 + a known element, plus a per-feature acceptance checklist in each plan group's gate. This is the missing gate that let 12 "done" features regress unnoticed.

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

### Wave-8 additions (final — audit closed at 105)
#271 block right-click context menu missing (#101, P1 — Notion-style Duplicate/Delete/Comment/Convert/Color/Move/Copy-link; reuse block-handle actions) · #272 approval 409 never auto-clears (#100, pairs #270) · #273 toggle-list collapse behavior ambiguous (#102) · #274 inconsistent slash-command ergonomics modal-vs-inline (#104, P1 — pick one pattern; ties #245/#254).
**Verified working (no issue):** #103 /flashcard modal (Front/Back/Deck) ✅ · #105 suggestion-Accept live drawer refresh ✅ (counter 3→2 live — proves the refresh-gap is per-surface, not global).

### Refetch-gap cluster (cross-cutting pattern — own scope group)
One root across many findings: server-rendered / list surfaces not re-fetching after a mutation (app uses `router.refresh()`, not TanStack), inconsistently applied.
- **WORKS:** suggestion-Accept (#105), filter-add 2nd-click, snapshot server-save toast, approval state.
- **BROKEN:** #75 snapshot drawer · #266 saved-search sidebar · #263 add-view tabs · cover swatch picker (no current-state echo).
**Fix as a single pass:** audit every mutation for refresh/optimistic-insert; standardize the pattern rather than scattered one-offs.

### Wave-9 additions (FINAL — 112 total)
#275 selection toolbar minimal (#107, P1 — add color/highlight/turn-into H1-3/comment-on-selection ⌘⇧M/align/sub-superscript/inline-math) · #276 no heading collapse affordance (#108) · #277 token scope names need tooltips (#106, security UX) · **#111/#112 → reinforced #254** (slash parser corruption propagates: stray char elevated to heading shows in /toc block = document-structure corruption, not cosmetic; /embed in empty area didn't open menu — raises #254 to top-P0).
**Verified working (no issue):** #109 mint-token modal (name/5 presets/16 custom scopes/expiry) ✅ · #110 /toc block auto-renders linked outline ✅.

**#254 priority escalation:** wave-9 confirms the slash parser bug corrupts persisted block hierarchy (#111 stray-char-as-heading bleeds into TOC), not just cosmetic leftover text. Highest-priority editor fix.

### Final consolidated P0 list (go/no-go order)
1. **#251** sign-out broken (security)
2. **#185** general-500 (ops: migration 0054 → redeploy also clears #2/#3/#5 misreports)
3. **#254/#274** slash parser leak + inconsistent ergonomics
4. **#252** comment renders raw markdown mention
5. **#270/#272/#100** approval-error UX (raw 409 + persistent)
6. **#271** block right-click context menu missing
- (#94/#259 ACL = P1 — backend shipped, just unwired, NOT a P0 feature gap)

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

---

## Appendix — Full findings index (1–112 → GH issue)

Per-finding fix detail lives in `docs/superpowers/v0.9.9-scope.md` (grouped by theme G0–G11). This index maps every audit finding number to its GitHub issue + title. `[REGRESSION]`/`[PARTIAL]` prefix = promised in a prior release (see lead section). Screenshot evidence: referenced in the engagement thread; attach per-issue as available.

- #185 — [REGRESSION pre-0.9] #1 [P0] /settings/workspace/general 500 — long-standing, predates v0.9.x
- #186 — #4/6/7 [P1] Chat bridge outside settings hub — relocate + dedupe nav
- #187 — #8 [P2] Workspace export: three terms for one page
- #188 — [REGRESSION v0.9.6×v0.9.8] #9 [P1] Lock-mode hides Suggest-edits+Bibliography — lock v0.9.6 × biblio v0.9.8 untested interaction
- #189 — [REGRESSION v0.9.7] #10 [P2] Page-editor toolbar no tooltips — v0.9.7 added WCAG labels to automation builder, not this bar
- #190 — [REGRESSION v0.9.7] #11 [P2] Submit-for-review button hierarchy — review workflow shipped v0.9.7
- #191 — #12 [P2] SSO Add buttons inconsistent variants
- #192 — #13 [P2] Active sessions show raw user-agent + Docker bridge IP
- #193 — #14 [P1] Security→Encryption self-service: misleading heading + red copy + no docs link
- #194 — #15 [P2] SMTP-disabled notification banner has no CTA
- #195 — #16 [P1] Notif prefs only 2 events; approval/status/lock types absent
- #196 — #17 [P2] Connectors page: two ~'connectors' sections
- #197 — #18 [P2] Connectors page: inconsistent create-button labels
- #198 — #19 [P2] Account→Profile: display name not editable
- #199 — #20 [P2] Account→Profile: no avatar upload
- #200 — #21 [P2] Account→Theme: tiny swatches + no live preview
- #201 — #22 [P2] Account→Theme: hex input doesn't show current hex for presets
- #202 — #23 [P2] /favorites no main-sidebar entry
- #203 — #24 [P2] API-key quotas empty state needs 'Mint a token →' link
- #204 — #25 [P2] /favorites empty state missing icon
- #205 — #26 [P2] Backlinks unlinked-mention snippets inconsistent (SQL bug)
- #206 — #27 [P1] New-page onboarding: literal 'Untitled', no autofocus/nudge
- #207 — #28 [P1] Sidebar not sticky — scrolls out of viewport on long pages
- #208 — #29 [P2] Sidebar too tall / not compact
- #209 — #30 [P2] PAGES tree fixed-px height, not flex
- #210 — #31 [P2] Default OS scrollbar in Pages tree
- #211 — #32 [P2] Scroll chaining: Pages tree edge bubbles to document
- #212 — #33 [P3] No scroll-position affordance in tall Pages tree
- #213 — #34 [P2] No expand-all/collapse-all on PAGES section
- #214 — [UNFINISHED v0.9.8] #35 [P1] Legacy orange covers not backfilled — v0.9.8 shipped palette, no migration
- #215 — #36 [P1] New-page creation: no naming step (extends #206)
- #216 — #37 [P1] New pages default to Published not Draft
- #217 — [REGRESSION v0.9.6] #38 [P0] Slash/mention raw text persists — superseded by #254 (root-caused)
- #218 — #39 [P2] In-page database: dead vertical space + floating unlabeled icons
- #219 — #40 [P2] SEE ALSO similarity scores all identical 9%
- #220 — #41 [P2] Semantic search results: no snippets/scores
- #221 — #42 [P2] Notification bell flyout: bare empty state
- #222 — #43 [P2] Trash/Flashcards/Favorites bare empty states
- #223 — #44 [P2] Theme toggle: dead first click (system→dark→light cycle)
- #224 — #45 [P1] Light-mode regressions (cover/approval banner/inline raw text/code blocks)
- #225 — #46 [P2] 'Invite member' navigates to page, not modal; label mismatch
- #226 — #47 [P2] No copy-link affordance after invite creation
- #227 — #48 [P3] Bell flyout close-button low contrast
- #228 — #49 [P2] Cover picker: 'Use default cover' is giant primary CTA
- #229 — #50 [P2] Cover picker gradient layout 6+2 awkward
- #230 — #51 [P2] Cover picker custom hex doesn't prefill current value
- #231 — #52 [P2] Icon picker category icons have no tooltips
- #232 — #53 [P1] Suggestions drawer shows no diff preview
- #233 — #54 [P2] Suggest-edits chip interaction inconsistent
- #234 — #55 [P1] Outline is a tiny popover, barely usable
- #235 — #56 [P2] Export options scattered across two menus + missing HTML/DOCX
- #236 — #57 [P2] Eye (focus/read) + Expand (hide sidebar) icons have no tooltip
- #237 — #58 [P2] Focus/read mode: no exit affordance beyond same icon
- #238 — #59 [P2] Expand mode hides sidebar with no re-show toggle
- #239 — #60 [P2] Cover image not clickable to edit
- #240 — #61 [P2] Add cmd+shift+E export shortcut + surface shortcuts in ⋯ menu
- #241 — #62 [P1] Database row click only edits cell, no row-detail panel
- #242 — #65 [P1] DB property type labels lowercase/underscored
- #243 — #66 [P1] DB missing common property types
- #244 — #67 [P2] DB '+ Add filter' first click no-op (popover race)
- #245 — #71 [P2] DB row + button and drag handle in wrong position
- #246 — #64 [P1] /equation insert has no visible input affordance
- #247 — #63 [P2] Expand/focus mode state persists across navigation
- #248 — #68 [P2] Template gallery preview is one-line only
- #249 — #70 [P2] Publish-to-web confirm modal lacks URL preview
- #250 — #69 [P2] Template gallery cards: two pills make card busy
- #251 — [REGRESSION v0.1.0] #80 [P0] Sign out broken — auth shipped v0.1.0, broken across 16 releases (security)
- #252 — [REGRESSION v0.3.0] #72 [P0] Comment renders raw @[Jon](uuid) — mention pipeline since v0.3.0
- #253 — #73 [P1] Comment mention: trailing text after @-pick dropped
- #254 — [REGRESSION v0.9.6] #38/76/77/111/112 [P0] Slash parser leak — v0.9.6 promised 'citation/file slash insert' fix; still silent + corrupts block hierarchy
- #255 — #74 [P2] Comment cards lack Edit affordance
- #256 — [REGRESSION v0.5.0] #75 [P2] Version-history drawer no refetch on save — version history v0.5.0
- #257 — #78 [P2] Webhook events list incomplete (CRUD only)
- #258 — #79 [P2] Webhook form: no select-all/recommended event helpers
- #259 — [REGRESSION v0.7.0] #94 [P1] Per-page permissions UI missing — v0.7.0 headline feature; backend shipped (page_acls 0057 + PageAclManager) but never wired to ⋯ menu
- #260 — #83 [P1] Markdown **bold** leaves asterisks visible
- #261 — #84 [P2] Strikethrough markdown shortcut not supported
- #262 — #86 [P1] CSS quotes pseudo bleeds curly quotes onto blockquote + li
- #263 — #95 [P2] Gallery 'Add view' click no-op (likely popover race, cf #67)
- #264 — [REGRESSION v0.9.6] #87 [P2] DB Add-view types grayed — v0.9.6 promised add-view tooltips/icons/empty-state
- #265 — #91/#92 [P2] Audit log Actor + Target show raw IDs not resolved names
- #266 — [REGRESSION v0.9.7] #88 [P2] Saved-search sidebar no live-update — saved searches shipped v0.9.7
- #267 — #89 [P2] Passkeys page leaks operator env-var names to all users
- #268 — #90 [P3] docs/operations.md referenced as plain path, not link
- #269 — #93 [P3] Audit log expand button shows even when metadata empty {}
- #270 — #96 [P1] Page review Approve → raw 'Decision failed (409)' error
- #271 — #101 [P1] Block right-click context menu missing
- #272 — #100 [P2] Approval 409 error never auto-clears
- #273 — #102 [P2] Toggle list collapse behavior ambiguous
- #274 — #104 [P1] Inconsistent slash-command ergonomics (modal vs inline)
- #275 — #107 [P1] Selection toolbar minimal — missing color/highlight/turn-into/comment/align
- #276 — #108 [P2] No heading collapse affordance
- #277 — #106 [P2] Token scope names have no tooltip

_Verified-working (no issue): #81 /login redirect · #82 mention autocomplete · #85 italic/code markdown · #97 code-block lang picker · #98 code-block copy · #103 /flashcard modal · #105 suggestion-accept live refresh · #109 mint-token modal · #110 /toc block · #99 biblio-0-badge untestable._
