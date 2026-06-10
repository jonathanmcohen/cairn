# Plan H — test-infra de-rot + polish batch

> **HOLD until GO.**

Ships **last** (the test-infra cleanup + the small polish reconciliations that
don't fit the feature plans). H1 (de-rot) may interleave EARLIER if legacy rot
blocks another item's spec from running — call that out when it happens rather
than working around a red harness.

## H1 — Legacy e2e de-rot

**Finding:** 10/29 non-`item-` e2e specs are red and are **excluded from the CI
gate** by the `tests/e2e/item-*` filter (documented in v0.9.19 plan-B). The gate
only ever runs the per-item specs, so the legacy suite has rotted unobserved.
Known rot classes from the v0.9.19 runs: Radix focus-scope console chips
(focus-trap warnings failing strict-console specs), fake-timer chips
(`vi.useFakeTimers` leaking across the Playwright boundary), and the axe a11y
budget drifting as the surface grew.

**Build:** triage the 10 red specs into {fix, rewrite, delete-as-superseded};
quarantine genuinely-obsolete ones with a documented reason (never a silent
skip); bring the survivors back under the CI gate by widening the filter or
porting them to `item-`-style names. Re-baseline the axe budget to the current
surface with the violations enumerated, not blanket-suppressed.

**Failure modes verified:**
- After de-rot, `pnpm test:e2e` (full, not just `item-*`) is green in CI, OR
  every excluded spec has a one-line documented quarantine reason in the suite
  (no silent exclusion — the GHA-skip-propagation lesson: a skipped gate that
  reads as "passing" is the trap).
- The Radix focus-scope chip is fixed at the source (focus management), not
  suppressed by relaxing the console assertion (spec keeps strict-console on).
- The a11y budget lists its known violations explicitly; a NEW violation still
  fails the gate (spec adds a contrived violation, asserts red).

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
30px row / 16px icon contract at the pixel level.

**Failure modes verified:**
- A CSS change that breaks the 30px row height fails the spec (spec perturbs the
  class in a fixture, asserts red) — the source-grep version could not catch
  this.
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

**H4b — Legacy `require_2fa` / `CAIRN_ENFORCE_2FA` cleanup.** The
General-settings `workspaces.require_2fa` control behind the default-off
`CAIRN_ENFORCE_2FA` env flag is a **sign-in no-op** (the real enforcement is the
v0.9.0 P8 MFA-policy path). **Decide + act:** either WIRE the legacy control to
the real policy engine or REMOVE the dead control + flag. Proposed default:
remove the dead General-settings toggle, since P8's policy is the live path.
Spec asserts the dead control is gone (or, if wired, that toggling it actually
enforces at sign-in).

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
- H4b: if removed, no settings control writes `require_2fa`; if wired, a
  sign-in without 2FA is actually blocked (no silent no-op either way).
- H4c: the import entry is role-gated identically to export (no privilege drift).
- H4d: the chosen health/readiness contract is asserted at the route level, and
  the decision (not just the code) is written down — no silent status-code flip
  that breaks an operator's LB config.

## Gate note

H1's success criterion is the strongest in the release: the FULL e2e suite green
in CI (or every exclusion documented). The v0.9.19 lesson that closed this loop
— a gate that only runs a filtered subset reads as "all passing" while the
unrun majority rots — is exactly what H1 repays.
