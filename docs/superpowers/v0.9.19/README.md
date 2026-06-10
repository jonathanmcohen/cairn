# v0.9.19 — audit cleanup + CI gates that actually run + carry-forward

No separate v0.9.18.1 hotfix: everything lands here. 12 items across 5 plans.

## Order (locked)

1. **Plan B — CI gates** (`plan-B-ci-gates.md`, 2 items) — ships FIRST so every
   later plan's regressions surface in CI, not in the user's browser.
2. **Plan A — v0.9.18 audit cleanup** (`plan-A-audit-cleanup.md`, 5 items)
3. **Plan C — carry-forward** (`plan-C-carry-forward.md`, 3 items)
4. **Plan F — MCP OAuth live-verify** (`plan-F-mcp-oauth-verify.md`, 1 item)
5. **Plan U — Notion polish remainder** (`plan-U-notion-polish.md`, 1 item)

## Gates (inherited from v0.9.18 + hardened)

The five v0.9.18 gates (`../v0.9.18/gates.md`) still apply: one PR per item off
`release/v0.9.19` (branch format `release/v0.9.19-item-<id>-<slug>`), browser
repro per PR, runtime spec per item, `verify-carry-forward-closed` CI block,
user verifies RC live before final tag.

### New artifact requirements (v0.9.19, per plan-letter PR)

Every PR description MUST include, or the tag does not happen:

1. **Spec file path** under `tests/e2e/` (or the layer that catches the bug,
   with justification).
2. **Spec output on main BEFORE the fix** — pasted, must be RED for fix PRs
   (guards state "guard — no before" explicitly; no fabricated befores).
3. **Spec output on branch AFTER the fix** — pasted, GREEN.
4. **Live-deploy verification** — navigate the repro path on the booted
   preview deployment, screenshot attached to the PR.

"PLAN X COMPLETE" reports MUST name the verification artifact path; a status
message without an artifact is a gate violation, not a completion.

## Why these gates got harder (v0.9.18 postmortem, one paragraph)

v0.9.18 shipped 10 items; the user found 5 broken live. Audit findings:
#117 was a true cross-merge regression (item spec red on main right now —
the item e2e suite was never wired into CI, only `test:a11y` was); #76's
guard tested Escape-cancel instead of the user's Cancel-button repro; #37's
migration changed only the column DEFAULT so pre-v0.9.9 workspace rows kept
`'published'`; A3's fix is env-gated and silently OFF when
`CAIRN_COLLAB_INTERNAL_URL` is unset; #5 shipped correctly but browsers keep
the pre-0.9.18 cached 308. Three failure classes: (1) specs that exist but
don't run in CI, (2) specs that test the wrong scenario, (3) code that is
right but the deployed environment/data is not. Plan B kills class 1; the
artifact requirements above attack classes 2 and 3.

## Reporting (verbatim strings)

- Per PR merge: `ITEM #XXX MERGED to release/v0.9.19 — spec output + screenshot attached.`
- RC ready: `v0.9.19-rc1 IMAGE READY — pull and verify.`
- After user VERIFIED: `v0.9.19 SHIPPED — image at ghcr.io/jonathanmcohen/cairn:v0.9.19.`

## Item index

| Plan | Item | One-liner |
|------|------|-----------|
| B | B1 | Wire item e2e suite (`pnpm test:e2e`) into ci.yml as a blocking job |
| B | B2 | Combined-release-branch full e2e re-run before any tag |
| A | A1 | #117 heading collapse — debug + re-land the cross-merge regression (spec red on main) |
| A | A2 | #76 slash parser leak — respec to Cancel-button path + fix PM selection |
| A | A3 | #37 default-page-status backfill migration (existing rows still 'published') |
| A | A4 | A3/Yjs bridge — boot warning + admin banner when CAIRN_COLLAB_INTERNAL_URL unset |
| A | A5 | #5 stale 308 — cache-buster headers on /settings/admin + workaround docs |
| C | C1 | #144 top-sidebar density follow-ups (palette 42→36 et al.) |
| C | C2 | #143 regression e2e — saved-searches + flashcards cross-workspace lock |
| C | C3 | #53/#54 suggest-edits — second-user-account e2e verification |
| F | F1 | MCP OAuth (v0.9.16 Plan F) — live-verify the full flow + e2e guard |
| U | U1 | Notion-polish audit remainder (v0.9.11 Plan U rows) — re-audit + ship gaps |
