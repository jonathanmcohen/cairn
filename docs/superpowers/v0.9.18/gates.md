# v0.9.18 Release Gates

Mechanical enforcement so no carry-forward item ships unverified. Gates are
**files**, not prose: a CI job, a PR template, a runtime-test harness, an RC
build script. Authored on `release/v0.9.18-gates` → PR into `release/v0.9.18`.

## The five gates

### Gate 1 — One PR per item
Each item gets its own branch + PR off `release/v0.9.18`. No bundling.

**Branch naming (corrected from the spec):** the requested format
`release/v0.9.18/item-XXX-slug` is **impossible** alongside a base branch named
`release/v0.9.18` — git refs are paths, and you cannot have both
`refs/heads/release/v0.9.18` (a file) and `refs/heads/release/v0.9.18/item-…`
(a directory) at once (D/F conflict). Resolution: base stays `release/v0.9.18`;
item branches use a **hyphen**: `release/v0.9.18-item-XXX-slug`.

Items (one branch each):
- `release/v0.9.18-item-A3-yjs-vs-api-content-sync`
- `release/v0.9.18-item-117-heading-collapse-chevron`
- `release/v0.9.18-item-B5-slash-menu-dismiss-on-modal`
- `release/v0.9.18-item-C1-sidebar-width-240`
- `release/v0.9.18-item-5-admin-redirect-to-audit`
- `release/v0.9.18-item-37-new-page-default-draft`
- `release/v0.9.18-item-76-slash-parser-leak-after-cancel`
- `release/v0.9.18-item-53-suggest-edits-inline-diff`
- `release/v0.9.18-item-54-suggest-edits-whole-chip-click`
- `release/v0.9.18-item-143-workspace-switch-savedsearches-flashcards-leak`

### Gate 2 — Manual browser repro per PR
PR description carries before (main HEAD, bug visible) + after (branch, bug
gone), captured via `mcp__claude-in-chrome__*` against the booted preview, as a
stitched PNG strip. Template: `.github/pull_request_template.md`.

> **Honesty constraint (read before generating PRs).** Every one of these 10
> items was, in prior cycles, verified **already shipped on `main`** (see
> `docs/superpowers/plans/v0.9.16/plan-G-carry-forward-status.md`, file:line).
> If an item does not reproduce on `main` HEAD, there is **no "before" bug to
> record** — fabricating one is forbidden. Such a PR is a **regression guard**:
> it states "already fixed in <commit>", links the fix, and ships the Gate-3
> runtime spec asserting the *fixed* behavior. The live failures the user has
> hit (e.g. `workspaces.icon` 42703, v0.9.16) were the **stale-deployment**
> class, not a code regression — the fix there is *redeploy*, not a re-fix.
> So the per-item flow is: **reproduce on `main` HEAD first** → if it
> reproduces, real fix + before/after; if not, regression guard + redeploy.

### Gate 3 — Spec at the layer that catches the bug
Each item gets a runtime spec under `tests/e2e/<item>.spec.ts` that loads the
real app (`playwright.e2e.config.ts`), performs the repro, and asserts UI state.
A unit/JSDOM spec may accompany but **cannot be the only spec**. Items needing
the full collab stack (A3 Yjs/Hocuspocus, #143 client-cache refetch) document
why and use the booted server + Hocuspocus from the e2e harness (already wired)
or the docker-compose preview + browser-driven check. Pattern file:
`tests/e2e/item-117-heading-collapse.spec.ts`. Run: `pnpm test:e2e`.

### Gate 4 — Carry-forward block (CI)
`.github/workflows/release.yml` job `verify-carry-forward-closed` (a `needs:`
of `build`) blocks the entire publish pipeline if any GitHub issue labelled
`<tag>` + `carry-forward` is still open. The label is derived from the tag
(`v0.9.18` tag → `v0.9.18` label), so it's reusable per release. Skipped for
prerelease tags (`-rcN`). Fails closed if `gh` is unavailable on the runner.

**Operator setup:** each tracked item must be a GitHub issue carrying both the
`v0.9.18` and `carry-forward` labels. Closing the item's PR (with `Closes #XXX`)
closes the issue → the gate passes. If no such issues exist, the gate passes
vacuously — so the labels are how this release decides what "complete" means.

### Gate 5 — User confirms in browser before the real tag
1. All item PRs merged to `release/v0.9.18`.
2. Build RC image: `scripts/build-preview-image.sh 0.9.18 rc1 --push` →
   `ghcr.io/jonathanmcohen/cairn:0.9.18-rc1`.
3. Reply: `v0.9.18-rc1 IMAGE READY — pull and verify. After all 10 items pass live, reply VERIFIED and I'll tag.`
4. User: `docker compose pull cairn && docker compose up -d cairn`.
5. User sweeps each item in browser, posts the pass/fail matrix.
6. All pass → user types `VERIFIED` → tag `v0.9.18` (the tag workflow runs Gate 4
   then builds + pushes `:0.9.18`).
7. Any fail → new RC after fixing only the failed items. No bundling.

## Reporting
- Per item merge: `ITEM #XXX MERGED to release/v0.9.18 — repro recording attached.`
- RC ready: `v0.9.18-rc1 IMAGE READY — pull and verify. After all 10 items pass live, reply VERIFIED and I'll tag.`
- After VERIFIED: `v0.9.18 SHIPPED — image at ghcr.io/jonathanmcohen/cairn:v0.9.18.`

## Files
- `.github/workflows/release.yml` — Gate 4 job + `needs:` on `build`.
- `.github/pull_request_template.md` — Gate 2 + Gate 3 required fields.
- `playwright.e2e.config.ts` + `tests/e2e/item-117-heading-collapse.spec.ts` — Gate 3 harness + pattern.
- `scripts/build-preview-image.sh` — Gate 5 RC image builder.
- `docs/superpowers/v0.9.18/gates.md` — this doc.
