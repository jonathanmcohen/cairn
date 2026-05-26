# v0.7.0 + v0.8.0 Retrospective

> Lessons from the v0.7.0 (MCP + automation + connectors) and v0.8.0
> (experience + 1.0-readiness) releases. Carry into v0.9.0+.

This is the working document for *what we did wrong* and *what the next
release loop should change*. Both releases shipped, but the path there
burned time on avoidable problems. Each lesson below has a concrete
mitigation. **Adopt all of them before writing the v0.9.0 plan suite.**

## 1. Branch discipline (highest-impact change)

**What happened.** Both v0.7.0 and v0.8.0 P-plans landed directly on
`main`. The plan-index of each release codified the rule:
"All P-plans land directly on `main` (no per-release feature branch)."
That convention is wrong.

**Why it bit.** Every fix-on-fix (P4 flake, P9 a11y race, P12 redirect
mismatch, P15-P17 keychain / CI flakes, P20 RSC bug, lighthouse triple
fix, GHCR auth thrash) landed on the production branch *before* being
verified. Reverting any one of them now means walking a chain of
already-merged plan commits.

**v0.9.0 rule.**

- Cut `release/v0.9.0` off `main` at the start of the release.
- Every P-plan + every fix-on-fix commits to the release branch.
- CI triggers on the release branch (add `release/**` to
  `.github/workflows/ci.yml`'s `on.push.branches`). Same gates apply.
- The release/smoke plan opens a **single PR** `release/v0.9.0` → `main`
  when CI is green, smoke is clean, and the release notes are written.
- Tag the merge commit on `main`. Release workflow fires from the tag.
- Delete `release/v0.9.0` after merge.

**What doesn't change.** Subagent-driven plan execution, frequent
commits per task, the `- [x]` plan-checkbox ritual. Only where the
commits land.

## 2. Plan-review discipline before dispatching implementers

**What happened.** Subagent-driven development uses a fresh implementer
per plan. I skipped the spec-reviewer pass between **plan write** and
**implementer dispatch**. The result:

- v0.8.0 P8 assumed `pages.metadata jsonb` existed. It didn't. First
  implementer correctly `BLOCKED`. Required a re-dispatch with four
  corrections folded in (add column in this plan's migration, switch
  `writeAuditLog` → `recordAudit`, extend `AUDIT_ACTIONS`, accept
  Drizzle's renumber).
- v0.8.0 P20 spec passed `onChange={() => {}}` from a server component
  to `<CoverPicker>` (a Client Component). Forbidden in RSC. Burned a
  release-blocker fix-on-fix.
- v0.7.0 P3: implementer caught an owner-bypass ordering issue
  mid-implementation; a plan reviewer should have spotted it.
- Migration numbering in v0.8.0 plans was aspirational (0029 = P8,
  0030 = P17, 0031 = P19, 0032 = P20). P7 *also* needed a migration
  (perf indexes) and took 0029, cascading every later migration up by
  one. Cost: per-plan rename + meta-journal update.

**v0.9.0 rule.** Run **two** subagent reviews per plan before
implementer dispatch:

1. **Spec compliance reviewer** — checks plan against spec.
2. **Plan reviewer (NEW)** — reads plan against current `main` HEAD:
    - Every referenced file path exists.
    - Every referenced column / function signature matches.
    - Migration number doesn't collide with prior plans in the suite.
    - No RSC → Client Component function props.
    - No coupling-without-coordination across plans (e.g. P12
      restructures routes that P11's palette deep-links into).

Add this step to `superpowers:subagent-driven-development` doc.

## 3. Test verification before push

**What happened.** Multiple "lint+typecheck+vitest pass locally → push →
CI catches the real problem" cycles. The full ladder was skipped:

- v0.8.0 P2: subagent couldn't run `pnpm test:a11y` locally because
  `cairn-a11y-pg` was still on `postgres:16-alpine` (no pgvector).
  Skipped the a11y run, pushed. CI revealed 9+ sub-44 touch-target
  violations on `/settings/developer|automation|connectors`. Required a
  separate fix commit.
- v0.8.0 P12 restructured `/settings/*` URLs; the touch-target spec
  still pointed at the old URLs which now 308'd into different content.
  Should have been one coupled plan, not two.
- Editor `aria-input-field-name` flake needed TWO fixes (textbox attrs
  on the contenteditable, then explicit `waitFor` in shell.spec.ts).
  Should have been one commit.
- Reindex CLI test: `drainHooks` slept 30 ms, racing CI's slower embed
  hook. Burned multiple CI cycles before converting to poll-until-N.
- oauth-state tamper test: appended `aa` to a sliced sig — no-op when
  the original ended in `aa` (~1/4096). Probabilistic flake from day
  one.

**v0.9.0 rule.** Per-plan completion checklist:

- [ ] `pnpm biome check .` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm vitest run` (full suite, not affected paths)
- [ ] `pnpm build` clean
- [ ] `pnpm test:a11y` (if the plan touches UI surfaces audited by a11y)
- [ ] Manual smoke of the touched route if non-trivial (not just code)
- [ ] Cross-plan grep for routes / endpoints / DB columns the plan
      introduces or deprecates — any plan that depends on the answer
      must land in the same branch

No "I'll trust CI" shortcuts. Local first.

## 4. Test stability: zero tolerance for probabilistic flakes

**What happened.** Three flaky tests cost CI cycles:

- `reindex-cli.test.ts` "embeds every page": 30 ms sleep + race on
  embed hook fire timing on slow runners.
- `oauth-state.test.ts` tampered-sig: 1/4096 chance the "tamper" was a
  no-op.
- `mobile-touch-targets.spec.ts`: webkit not installed (we set
  `browserName: 'chromium'`); dark-mode hydration race on editor.

**v0.9.0 rule.** When writing tests, **no time-based sleeps for state
the test owns.** Replace with:

- Polling (`waitFor(() => assertion)`) with a deadline.
- Explicit synchronization (`whenSynced`, `Promise.all` over
  observables).
- Deterministic mutations only (flip the first byte, never "maybe
  different" suffixes).
- Browser launches: pin `browserName` + `defaultBrowserType` to whatever
  the CI image actually has.

Add a test-style cheat-sheet to `docs/superpowers/test-stability.md`.

## 5. CI infrastructure changes are real plans

**What happened.** Multiple infra changes were treated as "small
follow-ups" but each required tag/retag thrash:

- macOS keychain credstore for arm64 docker push: four iterations
  (osxkeychain vs desktop helper, daemon vs CLI config, DOCKER_CONFIG
  honored or not, pre-write plain auth + DOCKER_HOST).
- Lighthouse self-hosted: three fixes (pgvector image, Chrome install,
  standalone server.js path).
- `gitleaks/gitleaks.tmp` stale on self-hosted /tmp: required user
  intervention to spot.
- Postgres 18 volume path change (`/var/lib/postgresql/18/docker`):
  caught only when user pointed it out.
- GHA actions Node 20 deprecation: only bumped after user prompt.

**v0.9.0 rule.** Treat every CI/infra change as a planned task with:

1. Statement of what changes (image, env var, runner, action version).
2. Statement of what consumers are affected (compose, Testcontainers,
   CI services, lighthouse, release).
3. Local validation step (build the image locally, etc.) before pushing.
4. Single coordinated commit (no "fix forward" chains).

`docs/operations.md` is the canonical reference for infra. Update it
**in the same commit** as any infra change.

## 6. Subagent dispatch quality

**What happened.**

- v0.8.0 plan-suite batch B (P10-P13 writer) died on API Overload at
  38 tool uses. Required recovery dispatch.
- v0.8.0 P2 implementer died at 80 tool uses on Overload after
  committing T1-T3. Recovery picked up T4+T5 from uncommitted state on
  disk. Lossy.
- Multiple agent dispatch briefs gave wrong source paths (P23 og-extract
  said `src/lib/editor/` when actual is `src/lib/unfurl/`). Caused
  agents to make small corrective decisions instead of executing.
- Multiple agents reported wrong baseline test counts.

**v0.9.0 rule.**

- **Split parallel-write batches into smaller units** (3 plans each
  max) to bound the per-agent context + reduce blast radius of
  Overload failures.
- **Always include the actual HEAD SHA + a quick `grep` for any path
  the brief references** so agents catch path drift before starting.
- **Implementer briefs include explicit "if you commit task N and then
  die, the next agent must re-verify task N's state" recovery
  instructions.** Recovery should be lossless.

## 7. Coupling across plans must be coordinated

**What happened.** Several plan pairs depended on each other but
landed without coordination:

- v0.8.0 P12 (settings hub restructure) changed every `/settings/*`
  URL. Touch-target audit spec from P2 referenced the old URLs.
  Required a third fix commit.
- v0.8.0 P11 (palette expand) added `app.openSettings` action that
  navigated to `/settings`. P12 made that a redirect. Worked by luck.

**v0.9.0 rule.** When two plans share a surface (routes, schema,
auth), they ship as **one** coupled plan with all touch-points updated
in the same commits. Coupling discovered late forces fix-forward; the
plan-review pass (rule §2) is the gate.

## 8. Compose / deployment artifacts can't lag the CI

**What happened.** `docker-compose.yml` `db` service stayed on
`postgres:16-alpine` through all of v0.7.0 even though Testcontainers
+ CI services had been on `pgvector/pgvector:pg16` since P11. Caught
only during v0.8.0 prep.

**v0.9.0 rule.** Every plan that changes a runtime dependency
(Postgres major, Node major, pgvector, etc.) updates **all five**
consumers in one commit:

1. `docker-compose.yml`
2. `tests/helpers/db.ts` (Testcontainers)
3. `.github/workflows/ci.yml` (services + auth)
4. `.github/workflows/lighthouse.yml` (services + auth)
5. `Dockerfile*` (runtime image base if relevant)

Add a checklist item to the plan template.

## 9. Plan checkboxes get checked as work lands

**What happened.** All 3,399 `- [ ]` boxes across the 101 plans stayed
unchecked through v0.7.0 and v0.8.0. Bulk-flipped at the end with
`sed`. The plan docs were perpetually showing "unstarted" while the
release was already in production.

**v0.9.0 rule.** Each implementer subagent must, as part of the final
task commit, edit the plan doc to mark every executed checkbox `[x]`.
The plan doc on `main` (release branch under §1) is the live status
view.

## 10. Roadmap stays a current source

**What happened.** `roadmap-0.6-to-1.0.md` only got updated after each
spec. Could have been kept incrementally fresh as plans completed.

**v0.9.0 rule.** Plan template's final task includes a step:
"Update `docs/superpowers/roadmap-*.md` checkbox for this plan."
Implementer ticks it as part of the commit that lands the plan.

---

## Carryover punch list for v0.9.0 prep

Before v0.9.0 brainstorming starts:

- [ ] Add `release/**` to ci.yml `on.push.branches`.
- [ ] Add `docs/superpowers/test-stability.md` with the
      no-sleep-on-owned-state rules.
- [ ] Update `superpowers:subagent-driven-development` skill doc to
      require a **plan-review** subagent dispatch before the
      implementer dispatch.
- [ ] Add the 5-consumer checklist (compose, Testcontainers, ci,
      lighthouse, Dockerfile) to the plan template.
- [ ] Update plan-writer doc to forbid "land directly on main" as a
      convention.
