# Plan C — carry-forward

Three items from the v0.9.18 outstanding list. Each is its own PR per the
gates.

## C1 — #144 top-sidebar density follow-ups

**Source scope:** `docs/superpowers/plans/v0.9.16/plan-C-top-sidebar-density.md`.
Remaining deltas (user-confirmed): command palette button 42px → 36px; plus
the plan's unshipped rows — workspace switcher trigger row → 32px, section
header margins tightened, PAGES header → 28px on fine pointer. First task is
a 10-minute re-audit of which rows already shipped (the plan partially landed
in v0.9.16-18); only unshipped rows get work.

**Files:** `src/components/sidebar.tsx`, `src/components/workspace-switcher.tsx`,
command-palette trigger component, `tests/components/sidebar*.test.tsx`.

**Coverage:** every density value asserted in a component spec (computed
height), not eyeballed; touch-target gate still passes (44px hit area via
padding trick where visual height < 44 — same pattern as
`sidebar-resize-handle.tsx`).

**Failure modes verified:** spec red before (asserts 36 where today renders
42) → green after; a11y gate (`pnpm test:a11y`) green — density change must
not shrink touch targets below 44px effective; RTL layout unaffected (ar
smoke in the component spec).

## C2 — #143 audit lock-in: saved-searches + flashcards cross-workspace e2e

**State:** the v0.9.18 fix (#143, PR #324: SW network-first for cookie-scoped
`/api` reads + hard navigation on workspace switch in
`workspace-switcher.tsx`) passed the user's live sweep. This item adds the
missing regression lock: a runtime e2e spec, since today's coverage is
unit-level (`tests/pwa/sw-strategy.test.ts` asserts the strategy table, not
the behavior).

**Files:** `tests/e2e/item-143-workspace-switch-isolation.spec.ts` (new).

- Spec: seed two workspaces with distinct saved-searches + flashcard decks →
  load workspace A (sidebar shows A's saved searches, flashcards due-queue) →
  switch to workspace B → assert NO element from A's saved-searches or
  flashcards renders at any point after the switch (poll during navigation,
  not just at settle), and the switch was a hard navigation
  (`page.waitForEvent('framenavigated')` / full document load).

**Coverage:** the two leak surfaces the user originally reported, plus the
hard-navigation mechanism itself.

**Failure modes verified:** spec is a guard (fix already live) — PR states
"guard — no before" per gates; spec must FAIL if either the SW strategy
regresses to URL-keyed caching (verified by temporarily flipping
`sw-strategy.ts` locally and watching it go red — paste that run in the PR as
the spec's own falsifiability proof) or the switcher reverts to soft nav.

## C3 — #53/#54 suggest-edits: second-user e2e verification

**State:** both shipped v0.9.13 (`diff-preview.ts` `<del>/<ins>`; whole-card
button onClick → scrollIntoView + setTextSelection) and got single-user
runtime guards in v0.9.18 (PRs #337/#338). Gap: suggestions are a two-actor
feature — author suggests, reviewer sees diff + clicks chip — and no spec
exercises two distinct accounts.

**Files:** `tests/e2e/item-53-54-suggest-edits-two-user.spec.ts` (new),
`tests/e2e/util.ts` (add second-account helper: create user B via API, second
browser context with its own auth state).

- Spec: user A opens page in suggest mode, makes a suggestion → user B (own
  browser context, editor role) opens the same page → suggestions drawer
  shows the card with inline `<del>`/`<ins>` diff (#53) → B clicks anywhere
  on the chip body (not the View button) → editor scrolls to and selects the
  suggested range (#54) → B accepts → content updates in BOTH contexts (Yjs).

**Coverage:** cross-account visibility, inline diff render, whole-chip click
target, accept round-trip over live collab.

**Failure modes verified:** guard (no before) — falsifiability proven the
same way as C2 (locally break the chip onClick, watch red, paste); both
contexts run against the SAME booted app + collab server so the Yjs path is
real, not stubbed.
