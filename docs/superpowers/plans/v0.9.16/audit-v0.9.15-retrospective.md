# v0.9.15 Retrospective — live-deploy sweep → v0.9.16

Findings from browser-testing the live `cairn.local.jonco.dev` deploy (v0.9.15) + the resulting v0.9.16 scope.

## Live test results (v0.9.15, current deploy)
1. **`/healthz` = `{"status":"ok","version":"0.9.15","db":"ok","uptime_seconds":17085}`** — deploy is current, not stale. Footer also shows `v0.9.15`.
2. **#1 `/settings/workspace/general`** — loads fully (General form: Workspace icon picker, name "test", Home page (none), Save settings). **No 500.** The v0.9.15 #1 fix + fresh migrate resolved it. The "still 500s" report was stale.
3. **#143 stale sidebar** — reproduced: on the "test" workspace the main pane shows "Your workspace is empty" and PAGES shows "No pages yet", but SAVED SEARCHES still lists "important" and Review-due still shows "5" (the previous workspace's data — not refetched). Confirms the soft-nav cache bug. Fixed in PR #320 (hard nav).
4. **#142 icon badge** — the switcher badge renders the name initial ("T"); the General settings icon picker shows a generic document glyph (test workspace has no icon). The badge never renders a set icon. Fixed in PR #320.

## Scope decisions for v0.9.16
- **Genuinely new + real:** Plan F (MCP OAuth 2.1) · Plan C (top-sidebar density #144).
- **Done, in flight:** #142/#143 (PR #320).
- **Carry-forward (A3/B3/B5/C1/E4/K2/#76/D1/D2/Plan U/Plan V):** verified shipped (see plan-G-carry-forward-status.md); #1 proven working live. Not rebuilt — stale backlog, zero-diff/no-op, re-break risk.

## Process notes
- The repeated "stale deploy" vs "carry-forward unfixed" confusion was resolved by reading the live `/healthz` version + a settings screenshot — cheaper and more conclusive than another round of code-reading or another rebuild. **Lesson: when a backlog claims long-standing breakage, check the live build version and test one item before scoping a rebuild.**
- Standing OOM chip (release.yml amd64 docker `next build` intermittently OOM-killed) still open; cleared on rerun each time.
