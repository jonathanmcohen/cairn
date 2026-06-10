<!--
v0.9.18 release gates (see docs/superpowers/v0.9.18/gates.md).
One PR per item. No bundling. Fill EVERY section — a PR missing the runtime
test or the before/after repro is not mergeable to release/v0.9.18.
-->

## Item

Closes #XXX

<!-- One sentence: what was broken and what this changes. -->

## Manual repro

### Before (main)

<!-- Screenshot / strip recorded on `main` HEAD showing the bug. If the bug
     does NOT reproduce on `main` (already fixed in code), say so explicitly
     and link the commit that fixed it — then this PR is a regression GUARD,
     not a fix, and must say "regression guard" here. Do not fake a before. -->

![before](before.png)

### After (this branch)

![after](after.png)

## Browser test path

1. …
2. …
3. **Assert:** …

## Runtime test (Gate 3)

<!-- Path to the Playwright/browser-mode spec that loads the real app, performs
     the repro, and asserts the UI state. A unit/JSDOM spec may accompany it but
     cannot be the only spec. If Playwright can't reach the behavior (e.g. needs
     the full Yjs/Hocuspocus collab stack), explain why and name the
     docker-compose-preview + browser-driven check used instead. -->

- Runtime spec: `tests/e2e/<item>.spec.ts`
- Unit spec (optional): `tests/…`

## Gate checklist

- [ ] Branch is `release/v0.9.18-<item>-<slug>`, base is `release/v0.9.18`
- [ ] Before/after repro attached (or "regression guard" justified above)
- [ ] Runtime spec added under `tests/e2e/` and passing
- [ ] `pnpm lint && pnpm typecheck` clean
- [ ] Issue carries the `v0.9.18` + `carry-forward` labels (so the tag gate tracks it)
