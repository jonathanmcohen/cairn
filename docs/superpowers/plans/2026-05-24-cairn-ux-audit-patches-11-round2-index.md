# Cairn UX Audit Patches — Round 2 (post-v0.9.3) Index

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Context:** v0.9.3 shipped the first patch round (audit items 1–36 + #47/#48/#49). A deeper deploy review found ~half of the round-1 fixes didn't hold + 31 new findings. This round (→ **v0.9.4**) addresses them on a single branch `patches/ux-audit-v0.9.4`, one PR, held for review.

**Tech stack / verify gate:** unchanged — `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test`; UI/route changes also `pnpm build`. New UI strings must pass the i18n gate (`pnpm i18n:check`; regenerate via `pnpm i18n:baseline` if needed). New interactive controls must hold WCAG AA contrast + ≥44px touch targets (a11y CI gate). Reuse the v0.9.3 `ui/select` + `ui/date-field` primitives.

---

## Reopened round-1 issues (v0.9.3 fix did NOT hold in deploy)

These were closed by PR #46 but reopened after the deploy review. Each plan that touches one must **first diagnose why the v0.9.3 attempt didn't resolve it** before re-fixing.

| GH | title | round-1 attempt | round-2 plan |
|---:|-------|-----------------|--------------|
| #15 | version footer link | P02 (link added) | P18 |
| #17 | duplicate top-right control box | P03 (toggles consolidated) | P13 |
| #18 | empty whitespace / column | P03 (padding) | P13 |
| #19 | empty DB block header row | P03 (header render) | P13 |
| #20 | headings inside callouts full size | P03 (CSS scale) | P13 |
| #27 | /my-tasks native date | P01 (DateField) | P19 |
| #29 | /notifications native dates | P01 (DateField) | P17 |
| #30 | mentions/replies pills active state | P06 | P17 |
| #34 | "Create key" grey pill | P07 (variant) | P19 |
| #39 | editor tab strip separators/active | P03 | P13 |
| #42 | sidebar resize handle | P02 (deferred — border only) | P18 |
| #44 | sign out separation | P02 (divider) | P18 |

## New findings (GitHub #50–#80)

| GH | summary | plan |
|---:|---------|------|
| #50 | MCP endpoint hardcoded localhost | P14 |
| #51 | templates grid orphan card | P11 |
| #52 | template badges identical | P11 |
| #53 | template Preview raw ► | P11 |
| #54 | palette literal "Mod+Shift+F" | P12 |
| #55 | palette shortcut shown for one action only | P12 |
| #56 | palette placeholder scope | P12 |
| #57 | default Note callout reads as "selected" | P13 |
| #58 | code-block "Auto" label unclear | P13 |
| #59 | toggle empty content placeholder | P13 |
| #60 | admin link non-functional | P15 |
| #61 | admin section unbuilt (404s) | P15 |
| #62 | members: owner Remove button | P16 |
| #63 | members: role lowercase | P16 |
| #64 | members: no Invite CTA | P16 |
| #65 | general: home-page native select | P16 |
| #66 | general: 2FA-required no enforcement | P16 |
| #67 | workspace settings sidebar no sub-page nav | P16 |
| #68 | security: no WebAuthn/passkey | P17* |
| #69 | security: no recovery-codes UI | P17* |
| #70 | security: no sessions / sign-out-all | P17* |
| #71 | security: "Set up 2FA" grey pill | P17* |
| #72 | notifications: only 2 event types | P17 |
| #73 | notifications: email/digest clickable w/o SMTP | P17 |
| #74 | notifications: SMTP banner red→neutral | P17 |
| #75 | page "…" menu no icons | P18 |
| #76 | page "…" menu missing actions | P18 |
| #77 | workspace switcher no icon/avatar | P18 |
| #78 | workspace switcher no Esc/click-outside | P18 |
| #79 | slash menu no icons | P18 |
| #80 | outline panel wide column | P18 |

\* Security group (#68–#71) is split: #71 (button style) is trivial polish; #68/#69/#70 are **net-new feature surfaces** (WebAuthn UI, recovery-codes UI, sessions list) — larger, may warrant their own dedicated plan (P17-security) and could slip to a follow-up release if scope balloons. Flag during planning.

## Plan files (this round)

- **P11** `…-12-templates-polish.md` — #51, #52, #53
- **P12** `…-13-command-palette.md` — #54, #55, #56
- **P13** `…-14-editor-blocks.md` — #57, #58, #59 + reopened #17,#18,#19,#20,#39
- **P14** `…-15-mcp-endpoint-origin.md` — #50
- **P15** `…-16-admin-section.md` — #60, #61
- **P16** `…-17-workspace-settings.md` — #62, #63, #64, #65, #66, #67
- **P17** `…-18-security-and-notifications.md` — #68–#74 + reopened #29, #30
- **P18** `…-19-menus-nav-chrome.md` — #75–#80 + reopened #15, #42, #44
- **P19** `…-20-reopened-formcontrols.md` — reopened #27, #34 + a diagnose-first checklist for all reopened items

## Round-2 batch-2 findings (page/workspace/editor flows) — GitHub #81–#115

Audit labels #68–#102 → GitHub #81–#115 (these are audit-sequence labels, not GH numbers — they do NOT collide with existing GH #68–#80).

| GH | summary | plan file |
|---:|---------|-----------|
| #81 | workspace create: no name/icon modal | `-21-` |
| #82 | workspace switch lands on /templates not home | `-21-` |
| #83 | new page random default emoji | `-22-` |
| #84 | empty page no "Type /" placeholder | `-22-` |
| #85 | comments compose no visible border | `-23-` |
| #86 | comment submit low contrast | `-23-` |
| #87 | comments empty state bare | `-23-` |
| #88 | version history no "save snapshot"/explain | `-23-` |
| #89 | version history empty-state icon | `-23-` |
| #90 | lock dropdown no icons / no custom duration | `-23-` |
| #91 | export menu no icons | `-23-` |
| #92 | export "PDF (via browser print)" relabel | `-23-` |
| #93 | cross-modal: panels stack; Esc dismiss | `-23-` |
| #94 | mobile: export dropdown overflows | `-23-` |
| #95 | mobile: language switcher icon-only | `-28-` |
| #96 | block hover handle no "+" insert | `-22-` |
| #97 | sidebar "Search…" opens palette not page search | `-25-` |
| #98 | "N open" badge non-interactive | `-23-` |
| #99 | db view tabs "+" prefix confusing | `-24-` |
| #100 | db empty state no count / top Add-row | `-24-` |
| #101 | suggesting Mark insert/delete no icons/tooltips | `-23-` |
| #102 | sidebar no right-click context menu | `-25-` |
| #103 | sidebar hover no quick actions | `-25-` |
| #104 | visibility (eye) toggle no label/active state | `-22-` |
| #105 | code-block language picker no search filter | `-26-` |
| #106 | code block no "Copy code" button | `-26-` |
| #107 | @ mention dropdown no avatars | `-26-` |
| #108 | @ surfaces only users (pages need [[) | `-26-` |
| #109 | palette ⌘K no auto-focus | `-27-` |
| #110 | palette page results rank below Actions | `-27-` |
| #111 | palette snippet no match highlight | `-27-` |
| #112 | palette "Save this search" unclear | `-27-` |
| #113 | palette "Mod+…" not platform-aware (dup of #54) | `-27-` |
| #114 | palette Escape unreliable dismiss | `-27-` |
| #115 | db "+ Table" click no result | `-24-` |

### Batch-2 plan files
- **`-21-workspace-flows.md`** — #81, #82 *(needs migration 0054: `workspaces.icon`; depends on P18 switcher rebuild)*
- **`-22-new-page-and-editor-chrome.md`** — #83, #84, #96, #104
- **`-23-page-action-panels.md`** — #85–#94, #98, #101 *(shared single-open-panel controller)*
- **`-24-database-block.md`** — #99, #100, #115 *(#115 root cause: created view never activated)*
- **`-25-sidebar-page-actions.md`** — #97, #102, #103 *(reuses P18 #76 actions)*
- **`-26-code-and-mentions.md`** — #105, #106, #107, #108
- **`-27-command-palette-2.md`** — #109–#114 *(#113 folds into P12/#54 formatter)*
- **`-28-mobile-responsive.md`** — #95

### Cross-plan dependencies (batch-2)
- **`ui/dialog.tsx`** primitive introduced by `-21-` (workspace create modal) — reuse for other modals.
- **DateField popover-calendar rewrite** (P17/`-18-`) is a prerequisite for #27 (`-20-`).
- **Platform shortcut formatter** (`src/lib/shortcuts/format.ts`, P12/`-13-`) is a prerequisite for #113 (`-27-`).
- **`duplicateOwnedPage` + page actions** (P18/`-19-` #76) are reused by sidebar row actions (`-25-` #102/#103).
- **suggestion-toolbar.tsx**: `-14-` (#39 styling) vs `-23-` (#98/#101 interactivity) — disjoint nodes, coordinate.
- **workspace-switcher.tsx**: `-19-` (#77/#78 rebuild) vs `-21-` (#81/#82 create+switch) — land `-19-` first.

> **Backlog is iterative** — the user expects further audit rounds after this lands.

## Round-2 batch-3 findings (formatting / publish / covers / slash) — GitHub #116–#123

Audit labels #103–#110 → GitHub #116–#123.

| GH | summary | plan file |
|---:|---------|-----------|
| #116 | no inline formatting bubble menu | `-29-` |
| #117 | ⌘K taken by palette vs insert-link | `-29-` |
| #118 | publish-to-web no confirmation | `-30-` |
| #119 | share password no visibility toggle | `-30-` |
| #120 | publish settings cramped → Share modal | `-30-` |
| #121 | "+ Add cover" non-functional | `-31-` |
| #122 | slash menu initial list too small (typeahead-only) | `-31-` |
| #123 | faint orange/red viewport glow (stuck focus) | `-32-` |

### Batch-3 plan files
- **`-29-editor-formatting.md`** — #116, #117 *(BubbleMenu via `@tiptap/react/menus` — already available, no new dep; ⌘⇧K link + ⌘K-when-selection)*
- **`-30-publish-share.md`** — #118, #119, #120 *(dedicated Share modal; new `ui/password-input.tsx`; reuses `ui/dialog.tsx` from `-21-`)*
- **`-31-cover-and-slash.md`** — #121, #122
- **`-32-border-glow-bug.md`** — #123 *(diagnose-heavy)*

### Batch-3 notable root-causes
- **#121 cover dead:** round-1 #16 (1b80c1f) kept the **legacy** `CoverImage` (PATCHes `pages.cover_url`) but the page renders from the **new** `pages.cover` jsonb via `CoverBanner` — so uploads land in a column nothing reads. The working `CoverPicker` (writes `pages.cover`) is the one #16 unmounted. Fix = restore `CoverPicker`, delete `CoverImage`.
- **#123 glow:** the global `:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset:2px }` paints around `.ProseMirror` after slash-popup teardown returns keyboard-focus; under the **amber/rose accents** `--ring` is orange/red → reads as an error glow. Fix = `focus-visible:outline-hidden` on the contenteditable (keep discrete-control rings for WCAG 2.4.7).
- **#117:** the palette's global `(meta|ctrl)+k` window handler has no selection/focus check → intercept ⌘K when an editor text selection is active; add ⌘⇧K as the always-on link shortcut.

### Batch-3 cross-plan deps
- `-30-` reuses `ui/dialog.tsx` (from `-21-`) + the eye-toggle pattern (`-18-`/#71 area).
- `-29-` bubble-menu link control + `-30-` share + `-22-` block-insert all add editor chrome — coordinate so they don't fight over the same toolbar/selection surfaces.

## Execution order

Cosmetic/low-risk first (P11, P12, P13, P18, `-22-`, `-23-`, `-28-`, `-31-`, `-32-`), then editor chrome (`-29-`), settings surfaces (P15, P16, P17), publish/data/flows (`-21-`, `-24-`, `-25-`, `-26-`, `-27-`, `-30-`), MCP (P14), reopened re-fixes (P19/`-20-`) interleaved. Respect the cross-plan dependencies above. Single branch → single PR → hold for review → v0.9.4.

## Full read-through audit (pre-execution)

All 21 detailed plans were read end-to-end (5 reviewers). Result: **87/87 open issues covered** by concrete tasks (file paths + code + verify + `Closes #NN`). No TBD/placeholder, nothing dropped. Defects found were fixed in commit `0d22e0b` (plan-number H1 drift on `-14-`/`-15-`/`-18-` + cross-refs; `#119`/`#122` weak `refs`→`Closes` trailers).

### Known deferrals / scope cuts (intentional — surfaced by the audit)

These do NOT auto-close on merge; they stay open as follow-ups. Implementers + reviewers: do not treat as bugs.

- **#70** (Security: active-sessions list / sign-out-everywhere) — blocked by the `jwt` session strategy (no server session store to enumerate). `-18-` ships only a minimal "sign out this browser" slice (`SessionsCard` → POST `/api/auth/signout` + honest stateless-session note, all i18n), commits `refs #70` (NOT `Closes`). **#70 stays open.**
  - **Deferred full-feature design (follow-up release):** add `users.token_version int not null default 0` (new migration). Mint it into the JWT in the `jwt` callback (`token.tv = user.tokenVersion` at sign-in); in the `session`/`authorized` callbacks compare `token.tv` against the current DB `users.token_version` and reject (force re-auth) on mismatch. Add `POST /api/auth/sessions/revoke-all` that bumps `users.token_version` (invalidating every outstanding JWT for that user) + records an `mfa.sessions_revoked_all` audit event. Add a dedicated security test suite (old JWT rejected after bump; new sign-in works; cross-user isolation). This is a meaningful auth change with its own migration + callback edits → it likely lands in a follow-up release, not this branch.
- **#61** (Admin sub-routes 404) — the admin UI exists at `/settings/admin/audit`; the 404 was a stale `audit-log` path + an Admin tab shown to non-admins. `-16-` resolves via role-gating (#60) + a verify-stale task + `gh issue comment 61`; if any admin page is genuinely unbuilt it's logged there, not silently fixed.
- **#108** (`@` surfaces users only) — `-26-` **documents** the `@`(users) vs `[[`(pages) split; full unify into one switcher is deferred (logged via `gh issue comment 108`).
- **#76** (page-menu Move-to) — `-19-` Task 5 has an explicit off-ramp: if the move-to *picker* exceeds ~30 lines, ship Delete/Duplicate/Copy-link and file Move-to as follow-up.
- **Reopened #17 / #18 / #39** (`-14-`) — CSS/layout diagnose-first re-fixes verified by `pnpm build` + manual dark/light check (no automated test); #19 does add a real test.
- **`-20-` diagnose checklist** — round-1 commit hashes are placeholders to resolve via `git log --grep` at implementation time (disclosed, not silent).
- **Migration 0054** required by `-21-` (#81) — `workspaces` has no `icon` column yet.

### Pending user decision
- Audit items **3 → GH #12** ("switcher chevrons read as sort") and **32 → GH #41** ("chevron too small to click") were **closed in round 1** and not listed in the reopen set. Currently closed; reopen only on request.
