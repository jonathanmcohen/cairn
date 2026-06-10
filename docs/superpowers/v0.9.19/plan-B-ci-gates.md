# Plan B — CI gates that actually run (ships FIRST)

v0.9.18's #117 regression shipped because the item e2e suite existed but was
never executed in CI: `.github/workflows/ci.yml`'s Playwright job runs only
`pnpm test:a11y`. Item specs ran locally per-branch, then the 10 merged
branches were never re-tested in combination.

## B1 — wire item e2e into CI

**Files:** `.github/workflows/ci.yml`

- Add job `e2e` (hosted `ubuntu-latest`), mirroring the a11y job's setup
  (pnpm, Node 24, Playwright Chromium cache + `--with-deps chromium`,
  embedding-assets cache, `rm -rf .next && pnpm build`), running
  `pnpm test:e2e` (= `playwright test --config=playwright.e2e.config.ts`).
- The e2e harness needs Docker (Testcontainers Postgres + collab) — confirm
  `playwright.e2e.config.ts` webServer env works on hosted runners the same
  way the vitest suites do (GHCR `packages: read` + docker login already
  proven in the security job; copy that block).
- Set `CAIRN_COLLAB_INTERNAL_URL` in the job env exactly as
  `playwright.e2e.config.ts` does locally, so the A3 path is exercised, not
  env-gated off.
- Upload `playwright-report/` artifact on failure (same as a11y job).
- Make the job REQUIRED: branch protection / merge queue treats `e2e` like
  the test matrix — a red item spec blocks the PR.

**Coverage**

- Every `tests/e2e/item-*.spec.ts` (7 today, grows per release) runs on every
  PR and every push to `main` and `release/*`.
- Hosted-runner envs gaps already solved elsewhere in ci.yml (GHCR login,
  pg client 18, HF asset cache) are reused, not re-derived.

**Failure modes verified**

- Item spec red on the PR branch → PR blocked (this is the new normal-path).
- Item spec red only in COMBINATION (cross-merge) → caught by the same job
  running on the `release/*` push after each merge — the exact #117 pattern.
- Docker unavailable / GHCR unauthenticated on the hosted runner → job fails
  loudly (Testcontainers throws), never silently skips. No `if:` conditions
  on this job, so the v0.9.18 transitive-skip bug class cannot recur here.
- Flaky spec → `retries: 1` in the Playwright config for CI only; a spec that
  fails twice is treated as real. No blanket-rerun-until-green.

## B2 — combined-release-branch e2e re-run before tag

**Files:** `.github/workflows/release.yml`, `docs/superpowers/v0.9.19/README.md`

- New release.yml job `verify-item-e2e` between `verify-carry-forward-closed`
  and `build`: checks out the tagged commit, runs the full `pnpm test:e2e`
  suite once. Tag artifacts only build if the suite is green AT THE TAG.
- Runs for rc tags AND final tags (rc is exactly where the combined branch is
  first exercised).
- `build.needs` gains `verify-item-e2e`; its `if:` extends the existing
  explicit result-check pattern (`result == 'success'` — never default
  `success()`, see the transitive-skip postmortem in the v0.9.18 release
  pipeline commits `52719ed`/`f956f0d`).
- `verify-carry-forward-closed` additionally asserts no item spec is red:
  satisfied by `verify-item-e2e` being a hard dependency of `build` (the
  assert lives in the pipeline, not in prose).

**Coverage**

- The exact gap that shipped #117: all item PRs merged → release branch never
  re-tested → tag built broken code. Now the tag itself re-runs the suite.

**Failure modes verified**

- Suite red at tag time → `build` never runs → no image, no release. Recovery
  documented: fix on the release branch, delete + retag (tags that produced
  no artifacts are safe to recreate — proven 3× during v0.9.18-rc1).
- Gate skipped for rc (carry-forward gate only) while e2e gate still runs —
  explicit per-dependency `if:` on `build` checks BOTH results so a skip in
  one cannot mask a failure in the other.
- Wall-clock cost: full e2e suite ~5-10 min on hosted runner with build cache;
  acceptable for tag-time only (not per-PR — per-PR runs are B1's job).
