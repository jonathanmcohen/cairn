# v0.10.0 — backup & restore + surface wiring

> **HOLD: do not touch code until the user replies GO on Plan B.** Scaffold only.

Primary deliverable: **backup & restore in the product** (the pg_dump/encrypt
engine has been CLI-only since v0.5). Secondary: wire the surfaces the re-audit
proved exist server-side with no UI, plus the one real carry-forward bug from
the v0.9.19 live-deploy sweep.

## Re-audit outcome (2026-06-10) — the scope, corrected

All 28 seeded items were re-audited against repo evidence (file:line) before
locking this plan — the v0.9.19 Plan-F/U correction discipline. **10 of 28
closed at audit time** (already shipped or premise-wrong), 12 are in scope,
6 defer to v0.10.1.

### Closed by re-audit — no work (10)

| Seed | Item | Verdict |
|------|------|---------|
| 1 | #117 heading collapse "runtime regression" | **Not a bug.** Hover-gated gutter chevron + click-gated decorations. Verified live: gutter hover mounts `[data-heading-collapse-toggle]` (`heading-collapse.tsx:34-76,103`), click sets `data-cairn-collapsed` + `hidden` on both child blocks (`heading-collapse-extension.ts:178-184`). The static no-hover DOM check could see neither layer (real attr is `data-cairn-collapsed`, never a `class*=collapse` or `data-collapsed`). item-117 e2e hovers→clicks→asserts the real path — green for the right reason. Residual: chevron *discoverability* → v0.10.1 UX row. |
| 7 | Webhook delivery log + retry | Shipped: inline Recent-deliveries table + per-webhook deliveries dashboard at `/settings/admin/webhooks/[id]/deliveries` + per-row Replay wired to the replay route. |
| 10 | MFA policy enforcement | Shipped: v0.9.0-P8 admin policy toggle enforced at password & passkey sign-in + step-up, tested. (Legacy `workspaces.require_2fa`/`CAIRN_ENFORCE_2FA` control is env-gated off by design — cleanup row deferred.) |
| 11 | SSO/SCIM Save | Shipped: OIDC/SAML edit + SCIM token mint/revoke all persist, emit audit rows, take effect at sign-in. "No-op stub" flag was stale. (Minor: OIDC form doesn't render a `scopes` field the route accepts.) |
| 13 | MCP active-session inspector | Shipped on `/settings/developer/tokens`: connected clients, last-call timestamp, scopes granted, revoke — all four facets, tested. |
| 17 | Workspace export/import | Shipped: full-workspace tarball export AND import, admin-gated UI, round-trip integration test. Distinct from per-page export. |
| 20 | Per-token rate-limit dashboard | Shipped (v0.9 P9/P10). "Live" = RSC re-fetch per load, not websocket — acceptable. |
| 21 | Federated search config | Shipped: config persists + drives cross-instance search. Hardening caveats logged (raw shared secret in `shared_secret_hash` column, no per-peer rate-limit) → security backlog. |
| 22 | Trash retention auto-empty | Shipped: cron executes the purge; requires `CAIRN_SCHEDULER_ENABLED=1` (documented operational requirement, not a code gap). |
| 23 | Static-site export | Shipped: MkDocs + Docusaurus targets produce buildable projects; UI + route + nav + tests present. |

### In scope (12) — plan letters

| Plan | Item | Seed | Bucket |
|------|------|------|--------|
| B1 | #76 slash-cancel leak (Cancel-button path) | 2 | **Real bug** (root-caused) |
| B2 | #117 correction record + verification-method note | 1 | Docs only |
| C1 | Backup snapshot UI (list + create-now) | 3 | Backend-exists-no-UI |
| C2 | Restore UI (upload/pick + confirm + read-only mode) | 4 | Backend-exists-no-UI |
| C3 | Scheduled backups (editor + retention + history) | 5 | Backend-stub |
| D1 | SIEM forwarder "Send test" button | 8 | Backend-exists-no-UI |
| D2 | Audit log CSV export | 9 | Net-new (contained) |
| D3 | OAuth registered-clients admin registry | 12 | Backend-exists-no-UI |
| D4 | Health/readiness admin panel | 14 | Backend-exists-no-UI |
| D5 | Archived-pages browse view | 18 | UI-incomplete |
| D6 | Storage usage indicator + quota admin | 19 | Backend-exists-no-UI |
| E1 | `?` opens the shortcuts sheet | 25 | UI-incomplete (tiny) |
| E2 | "What's new" in-app release-notes panel | 28 | Backend-stub |

### Deferred → v0.10.1 (6)

| Seed | Item | Why deferred |
|------|------|--------------|
| 6 | Selective restore (page/workspace from snapshot) | Net-new scratch-schema restore + FK remap; builds on C1–C3's infra. |
| 15 | Migration status panel | `compareJournalToDb` exists but boot-guard-only; operator-grade, low frequency. |
| 16 | pgvector HNSW rebuild trigger | `reindex-embeddings` CLI refreshes vectors only; REINDEX trigger is new surface. |
| 24 | Workspace brand (logo + primary color) | Net-new workspace-scoped theming; per-USER theme exists, brand doesn't. |
| 26 | Custom slash commands → templates | Net-new table + CRUD + editor union; reuses `templates/instantiate.ts`. |
| 27 | Onboarding tour | Wizard shipped (v0.8 P10); element-anchored tour is net-new. |
| — | UX rows from v0.9.19 sweep: #117 chevron discoverability; Suggest-mode auto-mark-on-type (manual select-then-mark is by design, `editor.tsx:493-497`); A4 banner placement (mounted only on `/settings/admin/upgrade`) | Design decisions, not bugs. |

## Order (locked)

1. **Plan B — carry-forward** (`plan-B-carry-forward.md`) — the one real bug
   ships first.
2. **Plan C — backup & restore** (`plan-C-backup-restore.md`) — primary
   deliverable.
3. **Plan D — surface wiring** (`plan-D-surface-wiring.md`) — six
   backend-exists gaps.
4. **Plan E — UX capstone** (`plan-E-ux-capstone.md`) — `?` sheet + What's-new
   panel (the panel ships last so it can announce v0.10.0).

## Gates (inherited from v0.9.19, unchanged)

One PR per item off `release/v0.10.0` (branch `release/v0.10.0-item-<id>-<slug>`).
Every PR description MUST include, or the tag does not happen:

1. **Spec file path** under `tests/e2e/` (or the layer that catches the bug,
   with justification).
2. **Spec output on main BEFORE the fix** — pasted, RED for fix PRs (guards
   state "guard — no before" explicitly; no fabricated befores).
3. **Spec output on branch AFTER the fix** — pasted, GREEN (×3 for e2e).
4. **Live-deploy verification** — navigate the repro path on the booted
   preview deployment, screenshot attached to the PR.

v0.9.19 lesson now mechanical: the item e2e suite is a blocking CI job
(`ci.yml` `e2e`, no `if:`) and `release.yml` `verify-item-e2e` gates the tag
with explicit per-dependency result checks. **New for v0.10**: every UI-wiring
item's spec must drive the surface through the proxy / real browser the way a
user would (the A1 lesson: static DOM greps and handler-import unit tests both
lie — see memory notes on proxy gating and hover-gated UI).

## Reporting (verbatim strings)

- Per PR merge: `ITEM <id> MERGED to release/v0.10.0 — spec output + screenshot attached.`
- RC ready: `v0.10.0-rc1 IMAGE READY — pull and verify.`
- After user VERIFIED: `v0.10.0 SHIPPED — image at ghcr.io/jonathanmcohen/cairn:v0.10.0.`
