# v0.10.3 — a11y seed sync · env-config-to-UI · UI quality sweep

> **HOLD: do not touch code until the user replies GO on Plan A11Y.** Scaffold only.

Single release, single tag, single image. **30 items locked across 3 plans.
Zero deferrals** (user decision 2026-06-14).

| Plan | Items | Theme |
|------|-------|-------|
| **A11Y** (5) | Accessibility seed synced to the live Cairn Guide doc tree; CI freshness gate; fresh-install seed | Test/seed infra |
| **CFG** (4) | Surface env-only config (SMTP, S3, scheduler) into Settings; system-health aggregation | Missing config UI |
| **Q** (21) | Re-audit + fix what's broken or rough in v0.10.2 live | UI quality sweep |

## Order (locked)

1. **Plan A11Y** — first; the seed-sync CI gate is infrastructure the rest relies on.
2. **Plan CFG** — unblocks the user-flagged missing config UIs (SMTP / S3 / scheduler).
3. **Plan Q** — polish sweep; many items are *verify-shipped* (may close at audit with no code).

## Migrations (provisional — confirm numbering at GO)

Latest applied on `main` is **0079** (v0.10.2 F3). v0.10.3 continues from 0080:

- **0080** — `is_seed_workspace_template` flag on `workspaces` (A11Y-5).
- **0081** — `scheduled_jobs` table (CFG-3 in-package scheduler).
- **0082** — workspace email (SMTP) config table (CFG-1) — *number TBD at lock*.
- **0083** — workspace/admin storage (S3) config table (CFG-2) — *number TBD at lock*.

Every migration backfills existing rows where behavior changes (the A3 lesson).
Secrets columns (SMTP password, S3 secret key) are encrypted at rest and
**write-once / never re-displayed** (standing security rule).

## Re-audit before lock (REQUIRED)

Each of the 30 items is **re-audited against the repo before its PR** —
verdict **SHIPPED** (close, no code, with `file:line` proof) or **GAP** (build,
with the missing `file:line`). Plan Q is mostly verify-shipped: Q-1, Q-9, Q-10,
Q-11, Q-12, Q-13, Q-14, Q-15, Q-16, Q-17, Q-21 reference v0.10.2 items that may
already be live — confirm with file:line + a live screenshot before writing any
code. No item rebuilds something that already exists.

## Per-PR gates (or the tag does not happen)

One PR per item off `release/v0.10.3` (branch `release/v0.10.3-item-<id>-<slug>`),
squash-merged. Every PR description MUST include:

1. **Spec file path** under `tests/e2e/` (or the layer that catches the
   regression, with justification — A11Y CI-gate scripts and migration
   integration tests are pre-justified exceptions).
2. **RED on `main` BEFORE** — pasted (guards state "guard — no before"; no
   fabricated befores).
3. **GREEN on branch AFTER** — pasted (×3 for e2e).
4. **Live-deploy verification** — screenshot committed under
   `docs/superpowers/v0.10.3/artifacts/`.

UI-wiring specs drive the real browser through the proxy. i18n gate on every PR
adding UI text: keys in `messages/{en,es,ar}.json`, no hardcoded JSX strings
(CI `i18n:check` bans them). e2e hygiene: unique per-run fixture strings
(persistent dev DB), no off-screen dropdown clicks.

## Coverage check (per plan)

Each plan doc ends with a **Coverage check** (every deliverable maps to a
build item) and a **Failure-modes-verified** list (each named failure mode has
a spec that exercises it). The plan is not GO-ready until both are filled.

## Release process (v0.10.2 conventions, unchanged)

- **No release candidate unless explicitly asked** — default to cutting the
  final `v0.10.3` tag directly (CLAUDE.md release-process rule).
- Items → `release/v0.10.3` → merged to `main` (merge commit) → tag `v0.10.3`
  on `main` → release.yml builds multi-arch `ghcr.io/jonathanmcohen/cairn:0.10.3`
  (+ `cairn-collab`). Carry-forward gate + tagged-commit e2e gate run on the
  final tag.

## Reporting (verbatim strings)

- Per PR merge: `ITEM <id> MERGED to release/v0.10.3 — spec output + screenshot attached.`
- After user VERIFIED live: `v0.10.3 SHIPPED — image at ghcr.io/jonathanmcohen/cairn:v0.10.3.`

## Plan docs

- [plan-A11Y-seed-sync.md](plan-A11Y-seed-sync.md) — 5 items
- [plan-CFG-config-ui.md](plan-CFG-config-ui.md) — 4 items
- [plan-Q-ui-quality-sweep.md](plan-Q-ui-quality-sweep.md) — 21 items (mostly verify-shipped)
