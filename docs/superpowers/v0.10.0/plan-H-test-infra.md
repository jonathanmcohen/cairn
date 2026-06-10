# Plan H — test-infra de-rot + polish batch

> **HOLD until GO.**

Ships **last among the plans — except E2 (What's-new), which ships after Plan H
at the very end of the release** so the panel can announce v0.10.0 itself. H1
(de-rot) may interleave EARLIER if legacy rot blocks another item's spec from
running — call that out when it happens rather than working around a red
harness.

## H1 — Legacy e2e de-rot

**Finding:** the non-`item-` e2e specs are **excluded from the CI gate** by the
`tests/e2e/item-*` filter (`ci.yml:496-504`, documented in v0.9.19 plan-B), so
the legacy suite rots unobserved. The v0.9.19 runs observed 10 red of the
then-29; today the suite is **8 non-item spec files / 32 test cases**
(auth-signout, comment-edit, empty-states-nav, search-refresh, security-ux,
slash-ux, theme-light-mode, workspace-onboarding) — the red count must be
re-measured at H1 start, not assumed. Rot classes observed in the v0.9.19 runs
(runtime evidence, re-confirm on the first full run): Radix focus-scope chips,
fake-timer leakage across the Playwright boundary, and axe failures as the
surface grew.

**Build:** run the full suite, triage every red spec into {fix, rewrite,
delete-as-superseded}; quarantine genuinely-obsolete ones with a documented
reason (never a silent skip); bring survivors back under the CI gate by
widening the filter or porting them to `item-`-style names. The axe gate is a
**zero-violation assertion** (`tests/a11y/axe.ts:13-23`, `toEqual([])`) — there
is no budget structure to re-baseline; red means either fix the violations or
introduce an explicit enumerated known-violations list (a new structure, each
entry with a reason), never a blanket suppression.

**Failure modes verified:**
- After de-rot, `pnpm test:e2e` (full, not just `item-*`) is green in CI, OR
  every excluded spec has a one-line documented quarantine reason in the suite
  (no silent exclusion — the GHA-skip-propagation lesson: a skipped gate that
  reads as "passing" is the trap).
- Any console-noise failure (e.g. the Radix focus-scope chip) is fixed at the
  source (focus management), not by deleting the assertion that caught it.
  (Note: the current harness has NO console assertions at all — if rot was
  console-driven it was via Playwright's own failures, and adding a
  strict-console fixture is an H1 option, recorded either way.)
- The a11y gate still fails on a NEW violation after de-rot (spec adds a
  contrived violation, asserts red) — whether the gate stays zero-violation or
  gains an enumerated list.

## H2 — `auth-signout.spec.ts` line-35 flake

**Finding:** local `auth-signout.spec.ts:35` flakes on the post-sign-out
`/`→`/login` re-check — a dev-DB-accumulation artifact (the persistent-DB
lesson), not in the CI gate, disclosed in PR #348.

**Build:** make the spec hermetic — assert the redirect via the hard-nav `load`
signature (the C2-from-v0.9.19 fix) instead of a soft URL poll, and seed/reset
the auth state the spec depends on rather than relying on accumulated dev-DB
rows.

**Failure modes verified:**
- The spec passes ×10 consecutively against a dirty (pre-populated) dev DB (the
  falsifiable anti-flake proof — accumulation must not change the outcome).
- Sign-out lands on `/login` via a real document `load`, asserted on the nav
  event, not a `waitForURL` race.

## H3 — C1 sidebar-density runtime-px guard

**Finding:** the v0.9.19 C1 sidebar-density guard is **source-assertion only**
(it greps the CSS/class, doesn't measure rendered pixels) — brittle, can pass
while the rendered row height drifts. Documented brittleness in the ledger.

**Build:** upgrade it to a runtime computed-px e2e: render the sidebar, read
`getBoundingClientRect().height` / computed `line-height` on a row, assert the
current contract at the pixel level. **The contract is 26px, not the ledger's
stale 30px** — `ROW_HEIGHT_PX = 26` (`virtualized-page-tree.tsx:31`, #208,
guarded by `tests/components/sidebar-density-tokens.test.ts`). The e2e asserts
against the exported constant, not a hardcoded number, so a deliberate token
change updates both in one place.

**Failure modes verified:**
- A CSS change that breaks the rendered row height (vs `ROW_HEIGHT_PX`) fails
  the spec (spec perturbs the class in a fixture, asserts red) — the
  source-grep version could not catch this.
- The measurement is taken after fonts/layout settle (no CLS race; the spec
  waits for the row to be stable before measuring).

## H4 — Polish batch (four reconciliations)

Four small items the re-audit surfaced that don't warrant their own plan. Each
is a contained PR with its own spec.

**H4a — OIDC IdP `scopes` field.** The OIDC IdP form doesn't render the
`scopes` field its PATCH route already accepts — the route can persist scopes no
UI can set. Add the field (default `openid profile email`), wired to the
existing PATCH. Spec: set scopes in the form → PATCH persists → re-render shows
them.

**H4b — `require_2fa` / `CAIRN_ENFORCE_2FA` reconciliation.** **Review
correction (2026-06-10): the ledger's "sign-in no-op" claim was wrong.**
`workspaces.require_2fa` IS enforced — not at the sign-in step, but by the
`(app)` layout (`src/app/(app)/layout.tsx:41-49`: any workspace requiring 2FA +
no enabled TOTP → forced redirect to `/settings/security?enroll=required`, via
`userHasWorkspaceRequiring2fa`, `two-factor.ts:148-163`). The actual debt is
three inconsistencies: (a) the `env.ts:137-143` comment still says "enforcement
is unimplemented" — stale; (b) `CAIRN_ENFORCE_2FA` (default OFF) hides the
settings toggle that was hidden BECAUSE enforcement didn't exist — the reason
is gone, so decide: default the flag on, or drop it; (c) the layout gate covers
pages only — `/api/*` is proxy-exempt, so an enrolled-nowhere user's session
still works against the API (decide if that's acceptable; document either
way). Spec: set require_2fa → un-enrolled member is redirected to enrollment
on next page load; the env comment and flag state match reality.

**H4c — Workspace import sidebar entry.** The workspace import page is reachable
only by direct URL (export has a sidebar entry, import doesn't). Add the
matching sidebar/settings entry. Spec: the entry exists and routes to import.

**H4d — `/api/health` 503 decision.** `/api/health` always returns HTTP 200
even when `db:'down'` (body-only signal; D4 surfaces this in the panel). Switch
to a real 503 on db-down is a **breaking change** for anything keyed on the
current always-200 behavior. **Decide explicitly:** keep `/api/health` as the
documented always-200 body-signal probe and point load balancers at `/healthz`
(which already 503s), OR add a NEW `/readyz` that 503s — but do NOT silently
change `/api/health`'s status code. Proposed default: document `/healthz` as the
readiness probe (D4 already reads it), leave `/api/health` unchanged, record the
decision. Spec asserts the documented contract for whichever branch is chosen.

**Failure modes verified (H4 batch):**
- H4a: a scope set in the form survives a reload (persist round-trip).
- H4b: enforcement spec is RED-able — a require_2fa workspace member without
  TOTP cannot reach app pages (redirect asserted); the stale env comment is
  gone; the flag decision (default-on or removed) is recorded.
- H4c: the import entry is role-gated identically to export (no privilege drift).
- H4d: the chosen health/readiness contract is asserted at the route level, and
  the decision (not just the code) is written down — no silent status-code flip
  that breaks an operator's LB config.

## Gate note

H1's success criterion is the strongest in the release: the FULL e2e suite green
in CI (or every exclusion documented). The v0.9.19 lesson that closed this loop
— a gate that only runs a filtered subset reads as "all passing" while the
unrun majority rots — is exactly what H1 repays.
