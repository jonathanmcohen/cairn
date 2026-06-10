# Deferred ledger → absorption record

**By user decision (2026-06-10) NOTHING is deferred past v0.10.0.** This file
was the parking lot; it is now the audit trail proving every one of the 22
parked items was folded into a v0.10.0 plan. No silent drops — each row below
names its plan home. If scope pressure later forces a cut, the cut is reported
explicitly in the release notes (pre-agreed first candidates: F3 → E6 → E5).

## Absorption map (22 → plans)

| # | Ledger item | v0.10.0 home |
|---|-------------|--------------|
| 1 | Selective restore (page/workspace from snapshot) | **C4** |
| 2 | Migration status panel (`compareJournalToDb` → surface) | **D7** |
| 3 | pgvector HNSW index rebuild trigger | **D8** |
| 4 | Workspace brand customization (logo + primary color) | **F1** |
| 5 | Custom slash commands → templates | **F2** |
| 6 | Onboarding tour (element-anchored) | **F3** |
| 7a | #117 chevron discoverability (sweep residual) | **E3** |
| 7b | Suggest-mode auto-mark-on-type (manual is by design) | **E4** (decision + impl) |
| 7c | A4 collab-bridge banner placement | **D4** (signal folded into Health panel) |
| 8 | Settings double-sidebar (REFACTOR; polish row 19) | **E5** |
| 9 | Top-toolbar consolidation (REFACTOR; polish row 5) | **E6** |
| 10 | Search-palette mount fade-in (polish row 15) | **E7** (rescoped: fade-in shipped v0.9.14 — E7 is the missing `motion-reduce` guard) |
| 11 | `peer_instances.shared_secret_hash` stores RAW secret | **G1** (real bug) |
| 12 | Inbound federated peer route lacks per-peer rate limit | **G2** |
| 13 | Refresh-token reuse = single-token revoke only (asymmetric) | **G3** |
| 14 | `/api/oauth/revoke` no client auth (RFC 7009) | **G4** (decision + impl) |
| 15 | `/api/oauth/register` unauthenticated + unthrottled | **G5** (prevention; D3 = detection/purge) |
| 16 | Legacy e2e de-rot (10/29 red, excluded from gate) | **H1** |
| 17 | `auth-signout.spec.ts:35` flake | **H2** |
| 18 | C1 sidebar-density source-assertion-only guard | **H3** |
| 19 | OIDC IdP form missing `scopes` field | **H4a** |
| 20 | Legacy `require_2fa` / `CAIRN_ENFORCE_2FA` sign-in no-op | **H4b** (wire or remove) |
| 21 | Workspace import page has no sidebar entry | **H4c** |
| 22 | `/api/health` always-200 even on `db:'down'` | **H4d** (decision; D4 surfaces it) |

## Notes on the absorption

- **Decisions, not silent fixes:** E4, G4, H4b, H4d are *design decisions* — each
  plan records the call (and its rationale) before implementing, so a "keep as
  is" outcome is documented, never a dropped item.
- **Detection vs prevention split (OAuth register):** D3 adds admin *visibility +
  purge* (#15 detection); G5 adds *flood-control* (#15 prevention). Both ship.
- **A4 banner (#7c)** is partially addressed by D4 folding the collab-bridge
  signal into the admin Health panel (a page admins actually visit) rather than
  leaving it only on `/settings/admin/upgrade`. If a dedicated banner is still
  wanted after D4, it is a follow-up — recorded, not promised.
- **Original triage targets** (the old "v0.10.1 / no version assigned" labels)
  are void: the user folded everything into v0.10.0. This file no longer assigns
  future versions.

## Carry-over from the v0.9.19 sweep (for completeness)

Of the v0.9.19 live-deploy findings: **A1 #117** ("heading collapse not in
runtime DOM") was the only one closed outright by the re-audit (README "Closed
by re-audit" table — working-as-designed, hover+click path verified; its
discoverability residual is row 7a → E3). The **suggestion-track** and
**A4-banner** findings were NOT closed — they are rows 7b and 7c above,
absorbed into E4 (decision + impl) and D4 (signal folded into the Health
panel). The one real bug from that sweep, A2 #76 slash leak, is **Plan B1**.
(Count note: the ledger is 22 numbered rows; row 7 splits into 7a/7b/7c, so
the absorption map lists 24 lines.)
