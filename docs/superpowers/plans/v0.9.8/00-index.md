# v0.9.8 Plan Suite — Index

**Type:** Hotfix release from the v0.9.7 production browser audit.
**Spec:** `docs/superpowers/specs/2026-06-01-v0.9.8-design.md`
**Branch:** `patches/v0.9.8` (single branch, single PR, no direct `main` landing).
**Discipline:** Zero-deferral — every audit item A–L resolves in v0.9.8.
**Baseline:** `main` @ 4fb177c (v0.9.7). Migrations: latest 0057 → v0.9.8 adds 0058–0061.

## Reconciliation note (read first)

5 of 12 reported items were already correct in source on `main` — the user's observations were **stale-deploy or wrong-URL artifacts**. Those shrink from "build" to "verify + targeted improvement." After merge, **redeploy from `ghcr.io/jonathanmcohen/cairn:v0.9.8`** to see the fixes. Detail in spec Section 0.

## Execution order & gating

Groups run **sequentially**, subagent-driven (one implementer per task, two-stage review, fresh context). Gate each group before the next: `pnpm lint` (0 err) · `pnpm typecheck` · `pnpm i18n:check` (none new) · group `pnpm vitest run` · `pnpm build` (BUILD_EXIT=0; in-build TS phase skipped per v0.9.7 fix). HOLD for explicit user merge at the end. Migrations land in their owning group, numbered in execution order.

| Group | Plan | Audit items | Tasks | Migrations |
|-------|------|-------------|-------|-----------|
| G1 | `G1-admin-sso-ia.md` | A, B | 7 | — |
| G2 | `G2-editor-cover-citation-polish.md` | C, D, K, L | 6 | — |
| G3 | `G3-collab-resilience.md` | I | 8 | — |
| G4 | `G4-live-refetch-orphan-sweep.md` | G, H | 8 | — |
| G5 | `G5-workflow-builder.md` | J | 14 | 0058 condition_tree, 0059 sort_order, 0061 automation_runs |
| G6 | `G6-chat-oauth-e2ee-release.md` | F, E + release | 26 | 0060 chat_oauth_installs |

## Audit item → group map

| Item | Description | Group | Build vs verify |
|------|-------------|-------|-----------------|
| A | Admin tab parent-nav dead-end + missing federated-search & user-mgmt pages | G1 | fix + build |
| B | SSO move into `/settings/admin/sso` + redirects | G1 | move |
| C | Cover default (slate-dusk, not orange) + expand palette + contrast-vs-title | G2 | verify + improve |
| D | Live citation count on bibliography toggle | G2 | build |
| E | Finish/verify/document E2EE (keep flag default-off) | G6 | verify + document |
| F | Full Slack + Discord OAuth installer | G6 | build |
| G | Live sidebar refetch gaps (comment-add, fav-reorder, notif mark-read) + e2e | G4 | build |
| H | CLI purge orphan empty Untitled pages | G4 | build (net-new) |
| I | Collab resilience: backoff + token-retry + offline banner + DNS docs | G3 | build |
| J | Workflow builder: AND/OR grouping + drag-reorder + searchable templates + run history | G5 | build |
| K | Lock indicator unlock-authority clarity | G2 | build |
| L | DOI lookup deep-test + fix surfaced bugs | G2 | test + fix |

## Issues

GitHub issues for A–L to be filed at PR time (one `Closes #` per item), per process. Tracking lives here until then.

## Decisions (locked with user)

1. Chat OAuth (F): full Slack + Discord installer.
2. E2EE (E): keep `CAIRN_ENABLE_E2E_ENCRYPTION` flag default-off; finish + document + verify.
3. Admin (A): fix nav + build federated-search + user-management pages.
4. Builder (J): all four sub-items.
5. Cover (C): verify slate-dusk + expand palette + contrast-vs-title-color.
6. Bibliography (D): add live count to toggle.
7. Collab (I): full resilience.
8. SSO (B): move into settings hub with redirects.
