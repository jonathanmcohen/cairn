# Plan A — v0.9.18 audit cleanup (P0)

Five items from the post-ship audit (2026-06-10). Evidence per item is in the
audit table delivered in-session; key facts restated inline so this doc stands
alone.

## A1 — #117 heading collapse: true code regression

**State:** `tests/e2e/item-117-heading-collapse.spec.ts` is RED on main right
now — `[data-heading-collapse-toggle]` never becomes visible after hovering
the heading (spec line ~113). PR #333's fix (PM plugin + decorations in
`src/components/editor/heading-collapse-extension.ts`) passed on its branch,
then regressed when the 10 item branches combined on `release/v0.9.18`.

**Files:** `src/components/editor/heading-collapse-extension.ts`,
`src/components/editor/heading-collapse.tsx`,
`src/components/editor/extensions.ts`,
`tests/e2e/item-117-heading-collapse.spec.ts`

- Step 1: bisect the release-branch merge sequence locally (`git log
  --merges release/v0.9.18` range) running the red spec at each merge —
  identify the interacting PR (prime suspect: #334's slash-extension change
  or an extension-ordering change in `extensions.ts`).
- Step 2: fix the interaction, NOT by reverting either feature.
- Step 3: extend the spec with a guard for the interaction itself (e.g. if
  ordering-sensitive, a spec that asserts both extensions coexist).

**Coverage:** chevron renders on hover; click collapses to next same-or-higher
heading; re-click restores; positions survive unrelated edits (tr.mapping).

**Failure modes verified:** spec red on main BEFORE (already true — paste in
PR); green on branch AFTER; green on combined release branch via Plan B's CI
job (this is the item Plan B exists for); live screenshot of collapse working
on the preview deployment.

## A2 — #76 slash parser leak: guard tested the wrong scenario

**State:** current spec covers `/footnote` → Escape → typed text preserved.
User's actual repro: type `/equation` → Enter → modal opens → click **Cancel
button** → type `/code` → the text leaks into the wrong block.

**Files:** `tests/e2e/item-76-slash-cancel-preserves-text.spec.ts` (rewrite),
`src/components/editor/slash-extension.ts`, the equation/math modal component
(dialog bus consumer), possibly `src/components/editor/heading-collapse.tsx`
siblings untouched.

- Step 1: rewrite the spec to the Cancel-BUTTON path on the equation modal:
  `/equation` → Enter → modal → click Cancel → type `/code` → assert `/code`
  appears as a fresh slash query in a clean empty paragraph at the original
  trigger location, no stray text in any other block. Run it — must be RED on
  main (if it's green, the repro needs the user's exact page state; go back
  to the user before writing a fix).
- Step 2: fix selection management — after modal Cancel, restore the editor
  selection to the slash-trigger position (the dialog bus's cancel path must
  dispatch the same exit-meta + selection restore as B5's
  `dismissSlashPopup`, then `setTextSelection` back to the trigger pos
  mapped through any concurrent transactions).

**Coverage:** Cancel-button path on a modal slash item (equation), Escape path
(existing spec stays), typed-text preservation, cursor location after cancel.

**Failure modes verified:** new spec RED on main (pasted) → GREEN on branch;
both cancel paths (button + Escape) asserted; collab mode on (harness default)
so Yjs position remapping is exercised; live screenshot.

## A3 — #37 default-page-status backfill migration

**State:** `drizzle/migrations/0066_default_page_status_draft.sql` changed
only the column DEFAULT. Workspaces created before v0.9.9 still store
`'published'`, so their new pages publish immediately. Code
(`src/lib/pages/create.ts:48`) is correct; the data is stale.

**Files:** `drizzle/migrations/00NN_backfill_workspaces_default_page_status_draft.sql`
(next free number at implementation time), settings copy in
`messages/en.json`/`es`/`ar`, `tests/api/` migration assertion.

```sql
-- 00NN_backfill_workspaces_default_page_status_draft.sql
-- v0.9.19 A3 (#37): 0066 changed only the column DEFAULT; rows written under
-- 0042's DEFAULT 'published' kept it. Backfill to the current product default.
-- Admins who explicitly chose 'published' AFTER v0.9.9 are indistinguishable
-- from pre-0066 rows — accepted: release notes call this out, and the setting
-- remains one click to flip back in Settings → Workspace → General.
UPDATE "workspaces" SET "default_page_status" = 'draft' WHERE "default_page_status" = 'published';
```

- Add a line to Settings → Workspace → General copy noting the workspace-level
  default and that v0.9.19 reset it to Draft.
- Test: integration spec inserts a workspace row with `'published'`, runs
  migrations, asserts `'draft'`.

**Coverage:** existing-row data fix; release-notes + UI copy disclosure.

**Failure modes verified:** migration idempotent (re-run = 0 rows); spec
proves the backfill; CHANGELOG calls out the intentional override of any
post-v0.9.9 explicit 'published' choices.

## A4 — Yjs bridge env auto-detect + warn (audit item A3)

**State:** API→Yjs bridge (`src/lib/collab/publish-client.ts`) silently
no-ops when `CAIRN_COLLAB_INTERNAL_URL` is unset. Compose has defaulted it
since v0.9.15 (`60eb81f`), but deployments with older compose files run
blind. Do NOT retro-enable — surface the misconfiguration only.

**Files:** `src/server/entrypoint.ts` (boot warning),
`src/app/(app)/settings/admin/upgrade/page.tsx` (banner),
`src/lib/collab/publish-client.ts` (export an `isBridgeConfigured()` helper),
i18n keys en/es/ar, unit spec.

- Boot log (exact string):
  `[collab] API↔Yjs bridge is DISABLED — set CAIRN_COLLAB_INTERNAL_URL in env to enable; PATCH /api/v1/pages/:id will only update DB, not live editor.`
- Admin → Upgrade page renders a warning banner when `isBridgeConfigured()`
  is false (server component reads the env; no client env leak).

**Coverage:** misconfigured deployments get a log line at boot AND a visible
admin banner; configured deployments see neither.

**Failure modes verified:** spec for both env states (set/unset) on the
helper + banner render; boot warning asserted in entrypoint unit test; banner
NOT shown when configured (no false alarms); env var never echoed with its
value into client HTML (leak-guard grep).

## A5 — #5 stale 308 cache cleanup

**State:** code on main is correct (landing page; spec
`tests/settings/admin-redirect.spec.ts` 6/6 green). Browsers that visited
pre-v0.9.18 cached the proxy's `308 /settings/admin → /settings/workspace/members`
permanently and never re-ask the server.

**Files:** `src/lib/settings/redirects.ts` / the proxy layer
(`src/proxy.ts`), sidebar/nav link sources for `/settings/admin`,
`docs/operations.md` (workaround), e2e spec.

- All redirect responses the settings proxy still emits become `307` (or
  carry `Cache-Control: no-store`) so this class can't recur.
- `/settings/admin` responses send `Cache-Control: no-store, must-revalidate`.
- Cache-buster: internal links to the admin index navigate to
  `/settings/admin?v=19` (one release only; the param is ignored by the page
  and stripped client-side after load) — a URL the stale 308 cache entry
  cannot match, so affected browsers reach the new landing page immediately.
- `docs/operations.md` gains the manual workaround (hard-reload / incognito /
  clear site data) for users who bookmarked the bare path.

**Coverage:** new visitors (already fine), stale-cache visitors via the `?v=19`
links, bookmark users via docs; future redirects no longer cacheable-permanent.

**Failure modes verified:** e2e asserts the no-store header on
`/settings/admin`; grep-test asserts no remaining 308 in the settings proxy
paths; live verification in a browser profile that has the stale 308 (record
before/after — this is the one item where the "before" must come from a
poisoned profile, not a fresh one).
