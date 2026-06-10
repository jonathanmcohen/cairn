# Deferred ledger — everything explicitly held past v0.10.0

Nothing is silently dropped; this is the complete parking lot as of the
v0.10.0 scaffold (2026-06-10). Triage targets are proposals, not commitments.

## v0.10.1 (committed deferrals — see README)

1. Selective restore (page/workspace from snapshot) — builds on v0.10.0 C1–C3.
2. Migration status panel (`compareJournalToDb` → admin surface + retry).
3. pgvector HNSW index rebuild trigger.
4. Workspace brand customization (logo + primary-color override).
5. Custom slash commands → templates.
6. Onboarding tour (element-anchored walkthrough; wizard already shipped).
7. UX rows from the v0.9.19 sweep: #117 chevron discoverability;
   Suggest-mode auto-mark-on-type (manual mode is by design,
   `editor.tsx:493-497`); A4 collab-bridge banner placement (mounted only on
   `/settings/admin/upgrade` — folding its signal into the v0.10.0 D4 health
   panel partially addresses this).

## Orphaned from v0.9.19 ("v0.9.20 triage" — v0.10.0 took that slot)

Recorded in `docs/superpowers/v0.9.19/plan-U-notion-polish.md`; re-homed here
→ propose v0.10.1:

8. Settings double-sidebar — workspace `<Sidebar>` + `SettingsSidebar` both
   render under `/settings` (REFACTOR; polish-audit row 19).
9. Top-toolbar consolidation — editor control strip + page action bar render
   as two stacked bars (REFACTOR; polish-audit row 5).
10. Search-palette mount fade-in (minor; polish-audit row 15).

## Security backlog (no version assigned — propose triage at v0.10.1 planning)

11. `peer_instances.shared_secret_hash` stores the RAW shared secret despite
    the column name (federated re-audit finding).
12. Inbound federated peer route lacks per-peer rate limiting.
13. Refresh-token reuse triggers single-token revocation only — no
    family/descendant revocation (asymmetric vs auth-code reuse, which DOES
    family-revoke; F1 investigation OQ).
14. `/api/oauth/revoke` performs no client authentication (RFC 7009 expects
    it; acceptable for the self-hosted threat model? — decide explicitly).
15. `/api/oauth/register` is unauthenticated and unthrottled (RFC 7591
    open-registration by design, but flood-control/rate-limit unscoped;
    v0.10.0 D3 adds admin visibility + purge, not prevention).

## Test-infra debt

16. Legacy e2e de-rot — 10/29 non-item specs red; excluded from the CI gate by
    the `tests/e2e/item-` filter (documented in v0.9.19 plan-B).
17. Local `auth-signout.spec.ts` line-35 flake (post-sign-out `/`→`/login`
    re-check; dev-DB accumulation artifact, not in the CI gate; disclosed in
    PR #348).
18. C1 sidebar-density guard is source-assertion only; runtime computed-px e2e
    upgrade deferred unless requested (brittleness risk documented).

## Minor polish (from re-audit verdicts)

19. OIDC IdP form doesn't render the `scopes` field its PATCH route accepts.
20. Legacy `workspaces.require_2fa` / `CAIRN_ENFORCE_2FA` General-settings
    control is a sign-in no-op behind a default-off env flag — remove or wire.
21. Workspace import page reachable only by direct URL (no sidebar entry;
    export has one).
22. `/api/health` always returns HTTP 200 even when `db:'down'` (body-only
    signal); v0.10.0 D4 documents it — switching to a real 503 is a separate
    breaking-ish change for anything keyed on the current behavior.
