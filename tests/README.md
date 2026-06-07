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
