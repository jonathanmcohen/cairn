# v0.10.0 — backup & restore + full backlog flush

> **HOLD: do not touch code until the user replies GO on Plan B.** Scaffold only.

Primary deliverable: **backup & restore in the product**. By user decision
(2026-06-10) the entire deferred ledger is absorbed into this release — nothing
is parked past v0.10.0. **33 items across 7 plans.**

## Re-audit outcome (2026-06-10)

All 28 seeded items re-audited against repo evidence (file:line) before locking
the plan. **10 closed at audit time** (already shipped or premise-wrong — table
below). The remaining 18, plus the previously-deferred ledger (orphaned v0.9.20
rows, security backlog, test-infra debt, polish), all land here.

### Closed by re-audit — no work (10)

| Seed | Item | Verdict |
|------|------|---------|
| 1 | #117 heading collapse "runtime regression" | **Not a bug.** Hover-gated gutter chevron + click-gated decorations. Verified live: gutter hover mounts `[data-heading-collapse-toggle]` (`heading-collapse.tsx:34-76,103`), click sets `data-cairn-collapsed` + `hidden` on both child blocks (`heading-collapse-extension.ts:178-184`). The static no-hover DOM check could see neither layer. item-117 e2e hovers→clicks→asserts the real path. Residual discoverability → E3. |
| 7 | Webhook delivery log + retry | Shipped: deliveries table + per-webhook dashboard + Replay wired. |
| 10 | MFA policy enforcement | Shipped: v0.9.0-P8 policy enforced at password & passkey sign-in + step-up. Legacy-toggle cleanup → H4. |
| 11 | SSO/SCIM Save | Shipped: persists, audits, takes effect at sign-in. OIDC scopes-field polish → H4. |
| 13 | MCP active-session inspector | Shipped on `/settings/developer/tokens` (all four facets). |
| 17 | Workspace export/import | Shipped end-to-end + round-trip test. Import sidebar entry → H4. |
| 20 | Per-token rate-limit dashboard | Shipped (RSC re-fetch "live"). |
| 21 | Federated search config | Shipped + wired. Hardening caveats → G1/G2. |
| 22 | Trash retention auto-empty | Shipped; requires `CAIRN_SCHEDULER_ENABLED=1` (documented). |
| 23 | Static-site export | Shipped (MkDocs + Docusaurus, buildable). |

### In scope (33) — plan letters

| Plan | Items | Theme |
|------|-------|-------|
| **B** (2) | B1 #76 cancel-path fix (real bug, root-caused) · B2 #117 correction record (docs) | Carry-forward |
| **C** (4) | C1 snapshot UI · C2 restore UI + read-only mode · C3 scheduled backups · C4 selective restore | Backup & restore |
| **D** (8) | D1 SIEM test-fire · D2 audit CSV · D3 OAuth client registry · D4 health/readiness panel · D5 archived-pages view · D6 storage usage + quota admin · D7 migration status panel · D8 pgvector index rebuild | Surface wiring |
| **G** (5) | G1 hash federated shared secrets · G2 per-peer rate limit · G3 refresh-token family revocation · G4 revoke-endpoint client auth (decision + impl) · G5 register flood control | Security hardening |
| **E** (7) | E1 `?` shortcuts sheet · E2 What's-new panel (ships LAST) · E3 #117 chevron discoverability · E4 suggest-mode auto-mark (design decision + impl) · E5 settings double-sidebar refactor · E6 toolbar consolidation refactor · E7 palette mount fade-in | UX |
| **F** (3) | F1 workspace brand (logo + primary color) · F2 custom slash commands → templates · F3 onboarding tour | Net-new |
| **H** (4) | H1 legacy e2e de-rot (incl. Radix focus-scope/timer chips + a11y budget) · H2 auth-signout flake · H3 C1 density runtime-px guard · H4 polish batch (OIDC scopes field, legacy 2FA toggle, import sidebar entry, `/api/health` 503 decision) | Test-infra + polish |

### Deferred past v0.10.0

**Nothing.** The ledger is fully absorbed (see `deferred-ledger.md` for the
absorption record). If scope pressure forces a cut mid-release, the cut is
reported explicitly — never silent — with F3/E6/E5 as the pre-agreed first
candidates (largest, lowest risk to defer).

## Order (locked)

1. **Plan B** — the one real bug ships first.
2. **Plan C** — primary deliverable (C4 last; it builds on C1–C3).
3. **Plan D** — surface wiring.
4. **Plan G** — security hardening (before net-new widens the surface).
5. **Plan E** — UX (E2 What's-new moves to the very end of the release).
6. **Plan F** — net-new features.
7. **Plan H** — test-infra + polish (H1 de-rot may interleave earlier if rot
   blocks other items' specs).
8. Version bump + CHANGELOG → `v0.10.0-rc1` → user verifies live (with the
   corrected verification methods from B2) → final tag.

## Gates (inherited from v0.9.19, unchanged)

One PR per item off `release/v0.10.0` (branch
`release/v0.10.0-item-<id>-<slug>`). Every PR description MUST include, or the
tag does not happen:

1. **Spec file path** under `tests/e2e/` (or the layer that catches the bug,
   with justification).
2. **Spec output on main BEFORE the fix** — pasted, RED for fix PRs (guards
   state "guard — no before"; no fabricated befores).
3. **Spec output on branch AFTER the fix** — pasted, GREEN (×3 for e2e).
4. **Live-deploy verification** — navigate the repro path on the booted
   preview deployment, screenshot attached.

Item e2e suite is a blocking CI job (`ci.yml e2e`, no `if:`);
`release.yml verify-item-e2e` gates the tag with explicit result checks.
UI-wiring specs must drive the real browser surface through the proxy
(handler-import tests don't count — the F1 lesson). Migrations land in
C4/D7/F1/F2 territory — every one must backfill existing rows where behavior
changes (the A3 lesson).

## Reporting (verbatim strings)

- Per PR merge: `ITEM <id> MERGED to release/v0.10.0 — spec output + screenshot attached.`
- RC ready: `v0.10.0-rc1 IMAGE READY — pull and verify.`
- After user VERIFIED: `v0.10.0 SHIPPED — image at ghcr.io/jonathanmcohen/cairn:v0.10.0.`
