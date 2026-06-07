# v0.9.14 Plan V — Test infrastructure split

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]) syntax. Prefix every shell command with `source ~/.zshenv && `.

## Goal

Split the monolithic Vitest shard job into a per-suite matrix so each of the 10 logical top-level test directories runs as its own CI job. Each job still runs serially within itself (Testcontainers `maxWorkers 1`) but the 10 jobs can interleave across the 2 self-hosted Linux runners — improving log locality and allowing faster triage when a single layer regresses. No test files are moved. A parallel `tests/blocks/` by-feature convention is established (empty dirs already exist) for all **new** specs produced in Plans A–U. `vitest.config.ts` is extended to pick up `.spec.{ts,tsx}` files in addition to `.test.{ts,tsx}` so those new specs are discovered. A `tests/README.md` records the dual-convention contract. The full 978-file by-feature reorg is explicitly deferred to a future PR.

## Architecture

```
.github/workflows/ci.yml
  jobs:
    ci:         lint + typecheck + build (unchanged)
    test:       REPLACED — matrix over 10 suites (below)
    security:   unchanged (continues to run tests/security explicitly)
    a11y:       unchanged
  (e2e job exists externally via pnpm test:a11y / Playwright — unchanged)

tests/
  # Existing by-layer dirs — 958 .test.{ts,tsx} files — NOT MOVED
  api/  components/  lib/  collab/  db/  integration/
  suggestions/  security/  siem/  unit/  app/  openapi/
  pwa/  server/  styles/  helpers/  a11y/  e2e/  e2e-flag/
  i18n/  scripts/

  # New by-feature convention — empty dirs already present, populated by Plans A–U
  blocks/         ← per-block-type regression specs (.spec.ts)
  workflow/       ← page-lifecycle / approval / suggest-edits specs
  settings/       ← settings-page specs
  ui/             ← component interaction / visual regression specs
  # NOTE: no `database/` — DB schema/migration specs stay in the existing
  #   `tests/db`; DB feature behaviour stays in `tests/lib` + `tests/components`.

vitest.config.ts
  include: ['tests/**/*.test.{ts,tsx}', 'tests/**/*.spec.{ts,tsx}', 'src/server/**/*.test.ts']
  exclude: ['**/node_modules/**', '**/.git/**', 'tests/a11y/**', 'tests/e2e/**']  # keep Playwright specs out of Vitest
  (everything else unchanged — pool forks, maxWorkers 1, isolate true)

tests/README.md   ← new, documents both conventions + local run commands
```

### Why the lighter path

The full reorg (move 978 files into by-feature dirs) would produce a 978-file diff with high conflict risk against every in-flight Plan A–U branch. The lighter path (CI matrix over existing dirs + new `.spec.ts` convention for new files) achieves the parallelism goal with zero file moves. Full reorg is captured as a deferred task.

### CI matrix vs 2 runners

21 matrix entries, 2 runners → at most 2 jobs run at once, draining as runners free up. The matrix `test` job replaces the old `test` job (which was 2 shards). Net change: 21 serial-within-job runs (one per Vitest dir) instead of 2 sharded ones. Wall-clock for the heaviest suite is similar to one shard; total CI time is dominated by the slowest single suite (likely `integration`/`db` Testcontainers). Trade-off accepted for per-suite log locality + the coverage invariant (no dir silently dropped). Most suites are tiny and drain fast.

## Tech Stack

- GitHub Actions matrix (`strategy.matrix.suite`)
- Vitest 4 — `pnpm vitest run tests/$SUITE --reporter=dot`
- Testcontainers 12 — per-file Postgres singleton (unchanged; each matrix job gets its own container)
- GHCR login for private `postgres-pgvector` image (unchanged)
- Markdown for `tests/README.md`

---

## Tasks

### T1 — Extend vitest.config include to cover `.spec.{ts,tsx}`

**Why first:** every subsequent task that adds `.spec.ts` files relies on Vitest discovering them.

- [ ] Read `/Users/jon/projects/cairn/vitest.config.ts` (already read — `include` is line 7).
- [ ] Edit `vitest.config.ts`: change the `include` array from

  ```ts
  include: ['tests/**/*.test.{ts,tsx}', 'src/server/**/*.test.ts'],
  ```

  to

  ```ts
  include: [
    'tests/**/*.test.{ts,tsx}',
    'tests/**/*.spec.{ts,tsx}',
    'src/server/**/*.test.ts',
  ],
  // CRITICAL: tests/a11y and tests/e2e are Playwright specs (*.spec.ts) that
  // import @playwright/test — they MUST NOT be collected by Vitest or the whole
  // suite fails at collection. Vitest's defaultExclude is only node_modules/.git,
  // so we re-include those defaults AND add the Playwright dirs. tests/e2e-flag
  // is a real Vitest *.test.ts (encryption-roundtrip) — do NOT exclude it.
  exclude: [
    '**/node_modules/**',
    '**/.git/**',
    'tests/a11y/**',
    'tests/e2e/**',
  ],
  ```

- [ ] Smoke-run a FULL collection to prove the Playwright specs are excluded and nothing breaks (the previous `tests/unit`-only smoke would pass even with the bug present — it must exercise full discovery):

  ```sh
  source ~/.zshenv && pnpm vitest run --reporter=dot
  # then sanity-check the Playwright dirs collect ZERO under vitest:
  source ~/.zshenv && pnpm vitest run tests/a11y tests/e2e --reporter=dot 2>&1 | grep -qiE "no test files found" && echo "a11y/e2e correctly excluded"
  ```

- [ ] Commit:

  ```sh
  source ~/.zshenv && git add vitest.config.ts && git commit -m "test: extend vitest include to discover .spec.{ts,tsx} files"
  ```

---

### T2 — Replace the `test` shard job with a per-suite matrix in `.github/workflows/ci.yml`

**Context:** the current `test` job (lines 141–181 of `ci.yml`) runs `pnpm test --shard=${{ matrix.shard }}/${{ matrix.total }}` with `shard: [1, 2]` / `total: [2]`. Replace it entirely with a matrix over EVERY Vitest test directory (21 entries; `{name, path}` objects so `server` can fold in `src/server`). The `security` job already runs `pnpm test tests/security` explicitly — keep it; `security` stays OUT of the matrix to avoid double-running. The `a11y` and `e2e` jobs remain as-is (Playwright). COVERAGE INVARIANT: the old shard job ran the whole Vitest set, so the matrix must list every dir or those tests silently stop.

- [ ] Open `/Users/jon/projects/cairn/.github/workflows/ci.yml` and locate the `test:` job (line 141).

- [ ] Replace the entire `test:` job (lines 141–181) with the following. **Preserve all surrounding jobs (`ci:`, `security:`, `a11y:`) exactly as-is.**

  ```yaml
  # Vitest suite, one job per top-level test directory.
  # Each job is serial within itself (Testcontainers maxWorkers 1) but the
  # jobs interleave across the 2 self-hosted Linux x64 runners — improving
  # log locality and triage speed vs the old 2-shard approach.
  #
  # COVERAGE INVARIANT: this matrix must run EVERY Vitest dir the old
  # `pnpm test --shard` covered, or those tests silently stop running.
  # Excluded ON PURPOSE (run elsewhere): `security` (dedicated `security` job),
  # `a11y` + `e2e` (Playwright, run by the `a11y` job / pnpm test:a11y),
  # `helpers` (shared helpers, no test files).
  # `server` folds in BOTH tests/server AND src/server (the vitest include
  # also matches src/server/**/*.test.ts — it must land in a job).
  # New-but-empty dirs (blocks/workflow/settings/ui) are listed so .spec.ts
  # files added by Plans A–U run automatically; vitest exits 0 on no files.
  test:
    runs-on: [self-hosted, linux, x64]
    permissions:
      contents: read
      packages: read
    strategy:
      fail-fast: false
      matrix:
        suite:
          - { name: api,         path: tests/api }
          - { name: app,         path: tests/app }
          - { name: blocks,      path: tests/blocks }
          - { name: collab,      path: tests/collab }
          - { name: components,  path: tests/components }
          - { name: db,          path: tests/db }
          - { name: e2e-flag,    path: tests/e2e-flag }
          - { name: i18n,        path: tests/i18n }
          - { name: integration, path: tests/integration }
          - { name: lib,         path: tests/lib }
          - { name: openapi,     path: tests/openapi }
          - { name: pwa,         path: tests/pwa }
          - { name: scripts,     path: tests/scripts }
          - { name: server,      path: "tests/server src/server" }
          - { name: settings,    path: tests/settings }
          - { name: siem,        path: tests/siem }
          - { name: styles,      path: tests/styles }
          - { name: suggestions, path: tests/suggestions }
          - { name: ui,          path: tests/ui }
          - { name: unit,        path: tests/unit }
          - { name: workflow,    path: tests/workflow }
    env:
      DATABASE_URL: postgres://cairn:cairn@localhost:5432/cairn_test
      AUTH_SECRET: ci-only-secret-not-used-in-production-padding-padding
      NEXTAUTH_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v6

      - name: Setup pnpm
        uses: pnpm/action-setup@v6

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      # Auth the docker daemon to GHCR so Testcontainers can pull the private
      # postgres-pgvector image during `pnpm vitest run`.
      - name: GHCR login (Testcontainers image)
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Test (${{ matrix.suite.name }})
        run: pnpm vitest run ${{ matrix.suite.path }} --reporter=dot
        env:
          TESTCONTAINERS_RYUK_DISABLED: 'true'
  ```

  > **Note on empty dirs today:** Vitest exits 0 when given a path with no matching files. Once Plans A–U add `.spec.ts` files under `tests/blocks/` etc., those suites activate automatically.
  > **Coverage check:** every Vitest dir under `tests/` is in the matrix EXCEPT `a11y`/`e2e` (Playwright), `security` (own job), `helpers` (no tests). `src/server` is folded into the `server` job. If you add a new top-level `tests/<dir>`, add it here too.

- [ ] Verify YAML syntax locally:

  ```sh
  source ~/.zshenv && node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8')" && echo "OK"
  ```

- [ ] Confirm one suite still passes in isolation (pick `unit` as it has no Testcontainers dependency if Docker is unavailable):

  ```sh
  source ~/.zshenv && pnpm vitest run tests/unit --reporter=dot
  ```

- [ ] Commit:

  ```sh
  source ~/.zshenv && git add .github/workflows/ci.yml && git commit -m "ci: replace test shard job with per-suite matrix (10 suites)"
  ```

---

### T3 — Create `tests/README.md`

**Purpose:** document the dual-convention so future implementers know where to put new tests and how to run suites locally.

- [ ] Create `/Users/jon/projects/cairn/tests/README.md` with the exact content below (no other files created):

  ````markdown
  # Tests

  ## Two conventions — know where to put new specs

  ### 1. By-layer (existing, 958 files — do NOT move these)

  The `tests/` tree is organised by technical layer. Every file uses the
  `.test.{ts,tsx}` suffix and is discovered by Vitest automatically.

  ```
  tests/
    api/          — Next.js route handler tests (vi.mock session)
    app/          — Next.js page / layout rendering tests
    components/   — React component unit tests
    lib/          — Pure library / helper unit tests
    collab/       — Hocuspocus / Yjs collaboration tests
    db/           — Drizzle schema + query tests (Testcontainers Postgres)
    integration/  — Cross-layer integration tests (Testcontainers Postgres)
    suggestions/  — Suggest-edits / suggestion engine tests
    security/     — Adversarial security suite (also run by the CI security job)
    siem/         — SIEM forwarder / audit pipeline tests
    unit/         — Miscellaneous unit tests without a dedicated layer dir
    openapi/      — OpenAPI generator tests
    pwa/          — PWA / service-worker tests
    server/       — entrypoint / server-startup tests
    styles/       — CSS regression helpers
    i18n/         — i18n hardcoded-string scanner tests
    scripts/      — build-script tests
    helpers/      — Shared test helpers (not test files themselves)
    a11y/         — Playwright accessibility tests (run via pnpm test:a11y)
    e2e/          — Playwright end-to-end tests
  ```

  ### 2. By-feature (new — use `.spec.{ts,tsx}` suffix)

  New regression specs written for v0.9.14 and later land in the following
  directories. Use the `.spec.ts` suffix so they are visually distinct from
  the by-layer suite and can be run in isolation.

  ```
  tests/
    blocks/       — Per-block-type regression specs
                    (task-list, checkbox, heading-collapse, slash-menu, …)
    workflow/     — Page-lifecycle / approval / suggest-edits specs
    settings/     — Settings-page and settings-route specs
    ui/           — Component interaction and visual regression specs
  ```

  > No `tests/database/`: DB **schema/migration** specs stay in the existing
  > `tests/db`; DB **feature behaviour** (filters, sort, views) stays in
  > `tests/lib` + `tests/components`. Adding a third DB dir would fragment them.

  Add subdirectories freely: `tests/blocks/task-list.spec.ts`,
  `tests/blocks/slash-menu.spec.ts`, etc.

  ## Running a single suite locally

  ```sh
  # Run the entire by-layer api suite
  source ~/.zshenv && pnpm vitest run tests/api --reporter=dot

  # Run a single new by-feature spec
  source ~/.zshenv && pnpm vitest run tests/blocks/task-list.spec.ts

  # Run all by-feature specs
  source ~/.zshenv && pnpm vitest run tests/blocks tests/workflow tests/settings tests/ui --reporter=dot

  # Run the full suite (slow — uses Testcontainers for every file)
  source ~/.zshenv && pnpm test
  ```

  ## Testcontainers / isolation gotcha

  Each test **file** boots its own Testcontainers Postgres via
  `tests/helpers/db.ts` → `beforeAll(startPostgres)` / `afterAll(stopPostgres)`.
  Vitest is configured with `pool: 'forks'`, `maxWorkers: 1`, `isolate: true` —
  this is intentional and **must not be changed**. With `isolate: false`, the
  module-level container singleton is shared across files, and the first file's
  `afterAll` tears down the container that later files still expect →
  mass `ECONNREFUSED`.

  New spec files that need a real database must follow the same pattern as
  existing integration/db tests: import `{ db, startPostgres, stopPostgres }`
  from `../helpers/db` and call them in `beforeAll`/`afterAll`. See
  `tests/integration/` for examples.

  ## CI matrix

  The CI `test` job runs each of the following as a separate matrix entry:

  | Suite | Path |
  |-------|------|
  | api | `tests/api` |
  | app | `tests/app` |
  | blocks | `tests/blocks` |
  | collab | `tests/collab` |
  | components | `tests/components` |
  | db | `tests/db` |
  | e2e-flag | `tests/e2e-flag` |
  | i18n | `tests/i18n` |
  | integration | `tests/integration` |
  | lib | `tests/lib` |
  | openapi | `tests/openapi` |
  | pwa | `tests/pwa` |
  | scripts | `tests/scripts` |
  | server | `tests/server src/server` |
  | settings | `tests/settings` |
  | siem | `tests/siem` |
  | styles | `tests/styles` |
  | suggestions | `tests/suggestions` |
  | ui | `tests/ui` |
  | unit | `tests/unit` |
  | workflow | `tests/workflow` |

  Coverage invariant: every Vitest dir under `tests/` is a matrix entry EXCEPT
  the three run elsewhere. `security` runs in the dedicated `security` CI job
  (also `pnpm audit` + gitleaks). `a11y` + `e2e` are Playwright, run by the
  `a11y` job via `pnpm test:a11y` (and excluded from Vitest via `vitest.config`
  `exclude`). `helpers` holds shared helpers, not test files. `src/server`
  tests are folded into the `server` entry.

  With 2 self-hosted Linux x64 runners, at most 2 matrix jobs execute
  simultaneously. The heaviest suites (integration, db) benefit most: they no
  longer block lighter suites (unit, lib) from starting.
  ````

- [ ] Confirm the file renders correctly (no extra content, no placeholders):

  ```sh
  source ~/.zshenv && wc -l tests/README.md
  ```

- [ ] Commit:

  ```sh
  source ~/.zshenv && git add tests/README.md && git commit -m "docs(tests): add README documenting by-layer + by-feature conventions"
  ```

---

### T4 — Place a `.gitkeep` in each empty by-feature dir so they survive git

Git does not track empty directories. Without a placeholder the four empty
dirs (`blocks/`, `workflow/`, `settings/`, `ui/`) vanish on checkout and the
CI matrix `test (blocks)` step finds no directory. (Most carry a `.spec.ts`
stub already from the v0.9.14 planning bundle; `.gitkeep` covers any that
are still empty when this lands.)

- [ ] Create placeholder files (only for dirs without a committed spec yet):

  ```sh
  source ~/.zshenv && touch tests/blocks/.gitkeep tests/workflow/.gitkeep tests/settings/.gitkeep tests/ui/.gitkeep
  ```

- [ ] Commit:

  ```sh
  source ~/.zshenv && git add tests/blocks/.gitkeep tests/workflow/.gitkeep tests/settings/.gitkeep tests/ui/.gitkeep && git commit -m "chore(tests): add .gitkeep to empty by-feature dirs"
  ```

---

### T5 — Full verification gate

- [ ] Run the full Vitest suite to confirm nothing is broken:

  ```sh
  source ~/.zshenv && pnpm test
  ```

- [ ] Run lint + typecheck to confirm no regressions:

  ```sh
  source ~/.zshenv && pnpm lint && pnpm typecheck
  ```

- [ ] Confirm `blocks` suite exits 0 with no files (it should print "No test files found"):

  ```sh
  source ~/.zshenv && pnpm vitest run tests/blocks --reporter=dot; echo "exit: $?"
  ```

- [ ] All checks green → Plan V gate passed. **Do not push** — controller pushes.

---

### T6 — Document full reorg as DEFERRED (own future PR)

- [ ] Open this file (`plan-V-test-infrastructure.md`) and add the following section after the gate:

  ```markdown
  ## Deferred: full by-feature reorg (future PR, post-v0.9.14)

  The 958 existing `.test.{ts,tsx}` files under `tests/api/`, `tests/lib/`,
  `tests/components/`, etc. were intentionally **not moved** in this plan.
  A full migration would reorganise them into a `tests/features/` tree mirroring
  `src/` (one dir per domain: `pages`, `blocks`, `databases`, `collab`, `auth`,
  …) and would require updating ~200+ relative import paths to `../helpers/db`.

  That migration is safe to do in a single dedicated PR once v0.9.14 ships:
  1. Create `tests/features/<domain>/` dirs.
  2. Move each `.test.ts` file with a mechanical `git mv`.
  3. Fix all relative helper imports (sed one-liner or codemod).
  4. Update `vitest.config.ts` include to `tests/**/*.{test,spec}.{ts,tsx}` (no path change needed if using `tests/**`).
  5. Update `ci.yml` matrix `suite:` list to match new top-level dirs.
  6. Delete now-empty by-layer dirs.

  Track as a separate issue/PR — do not merge into any v0.9.14 plan branch.
  ```

- [ ] Commit:

  ```sh
  source ~/.zshenv && git add docs/superpowers/plans/v0.9.14/plan-V-test-infrastructure.md && git commit -m "docs: capture full test reorg as deferred (plan V)"
  ```

---

## Deferred: full by-feature reorg (future PR, post-v0.9.14)

The 958 existing `.test.{ts,tsx}` files under `tests/api/`, `tests/lib/`,
`tests/components/`, etc. were intentionally **not moved** in this plan.
A full migration would reorganise them into a `tests/features/` tree mirroring
`src/` (one dir per domain: `pages`, `blocks`, `databases`, `collab`, `auth`,
…) and would require updating ~200+ relative import paths to `../helpers/db`.

That migration is safe to do in a single dedicated PR once v0.9.14 ships:
1. Create `tests/features/<domain>/` dirs.
2. Move each `.test.ts` file with a mechanical `git mv`.
3. Fix all relative helper imports (sed one-liner or codemod).
4. Update `vitest.config.ts` include to `tests/**/*.{test,spec}.{ts,tsx}` (no path change needed if using `tests/**`).
5. Update `ci.yml` matrix `suite:` list to match new top-level dirs.
6. Delete now-empty by-layer dirs.

Track as a separate issue/PR — do not merge into any v0.9.14 plan branch.
