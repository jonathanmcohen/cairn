# v0.9.14 Plan U — Notion polish pass

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]). Prefix every shell command with `source ~/.zshenv && `.

## Goal

Apply the remaining open items from the 20-point Notion polish audit. v0.9.11 Plan U shipped the PATCH set (typography rhythm, sidebar density tokens, status-color tokens, block-handle transition, button press-scale, empty-state icons, skeletons). v0.9.13 Plan C shipped sidebar density visuals (sticky shell, compact rows, scrollable tree). This plan covers only what is **still open** after reading the live code: 4 PATCH-NOW items (color token replacements, cover hairline, palette fade-in, remaining raw color callsites) and documents 3 REFACTOR-DEFER items as explicitly out of scope.

Cross-references:
- Plan C: cover/spacing/density — complete; do NOT duplicate.
- `docs/superpowers/plans/v0.9.14/polish-audit.md` — authoritative 20-row verdict table (written alongside this plan).

## Architecture

All PATCH-NOW changes are **CSS class or token substitutions only** — no new components, no schema changes, no migrations, no new API routes.

- `src/app/globals.css` — no changes needed (all tokens already present: `--color-success`, `--color-warning`, `--color-destructive`).
- `src/components/editor/suggestions-drawer.tsx` — swap 4 raw color classes.
- `src/components/pages/version-history.tsx` — swap 2 raw diff-pill color classes.
- `src/components/account/profile-form.tsx` — swap 2 raw inline-feedback color classes.
- `src/components/pages/cover-banner.tsx` — add `border-b border-border` to 4 cover variant `div`/wrapper elements.
- `src/components/search-palette.tsx` — add `animate-in fade-in-0 zoom-in-95 duration-150` to `<Command>` container.

No interactive height changes anywhere. All changes are pointer-gated or purely decorative.

## Tech Stack

- Next.js 16 App Router, React 19, TypeScript strict
- Tailwind CSS v4 (CSS-first `@theme`; existing `--color-success`/`--color-warning`/`--color-destructive` semantic tokens)
- `tw-animate-css` (already imported `globals.css:2`; `animate-in`, `fade-in-0`, `zoom-in-95` utilities available; respects `prefers-reduced-motion` automatically)
- Biome v2 lint+format — run `source ~/.zshenv && pnpm lint` after each task
- Vitest v4 — run `source ~/.zshenv && pnpm vitest run` at gate

---

## Out-of-scope items (REFACTOR-DEFER — do not implement in this plan)

These three items from the original audit require structural component work that exceeds the patch budget for v0.9.14:

| Item | Why deferred |
|---|---|
| **R1 — Shared `Badge` primitive** (audit #6) | New `ui/badge.tsx` + 4 callsite migrations across different component trees; real risk of dark-mode pill spacing/color regressions. Dedicated PR in a later release. |
| **R2 — Right-rail slide-in via `Sheet`** (audit #18) | Five independent `fixed inset-y-0 right-0` rails each need Radix Dialog wrapping or per-rail `data-[state]` open/close wiring; high change surface + z-index / focus-trap risk with existing panel controller. |
| **R3 — Settings single-sidebar** (audit #19) | Hiding workspace `<Sidebar>` inside `/settings/*` requires careful pathname-conditional in a server layout; regression risk for 2FA enrollment gate redirect loop in `(app)/layout.tsx`. |

## 20-dimension status table

See `docs/superpowers/plans/v0.9.14/polish-audit.md` for the full evidence table. Summary by verdict:

| Verdict | Items |
|---|---|
| SHIP-ALREADY | #1, #2, #4, #7, #9, #10, #11, #12, #13, #14, #16, #17 (10 of 17 now SHIP) |
| PATCH-NOW | #3 color tokens, #8 cover hairline, #15 palette fade-in (4 total tasks below) |
| REFACTOR-DEFER | #6 Badge, #18 rail animations, #19 settings sidebar |
| VERIFY-LIVE | #5 toolbar rows, #20 mobile collapse |

---

## Tasks

### U1 — Replace raw diff/status colors with semantic tokens

**Files:** `src/components/editor/suggestions-drawer.tsx`, `src/components/pages/version-history.tsx`, `src/components/account/profile-form.tsx`

**Why:** These three files still contain raw Tailwind `text-green-700`, `text-red-700`, `bg-green-500/10`, `bg-red-500/15` classes that were flagged in audit item #3. The `--color-success` and `--color-destructive` tokens already exist in `globals.css:82-85`. Replacing them ensures dark-mode fidelity (the raw `green-700` has poor contrast on `zinc-900` dark backgrounds; `text-success` is theme-aware).

**A11y note:** Both `text-success` and `text-destructive` must maintain ≥ 4.5:1 against their background — they already do in the existing token chain (same as `text-green-600 dark:text-green-400` used elsewhere). Do not change font size or remove `role="alert"` / `role="status"` attributes.

- [ ] **U1-T1 — suggestions-drawer.tsx raw colors**

  Open `src/components/editor/suggestions-drawer.tsx`.

  Find line 56 (`bg-red-500/10 px-0.5 text-red-700 line-through`): replace `bg-red-500/10` with `bg-destructive/10` and `text-red-700` with `text-destructive`.

  Find line 68 (`bg-green-500/10 px-0.5 text-green-700 no-underline`): replace `bg-green-500/10` with `bg-success/10` and `text-green-700` with `text-success`.

  Find line 88 (accept button `text-green-700 … dark:text-green-400`): replace with `text-success`.

  Find line 95 (reject button `text-red-700 … dark:text-red-400`): replace with `text-destructive`.

  ```bash
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

  Commit: `fix(ui): replace raw diff green/red with success/destructive tokens in suggestions-drawer`

- [ ] **U1-T2 — version-history.tsx raw diff-pill colors**

  Open `src/components/pages/version-history.tsx`.

  Find line 309 (`bg-green-500/15 text-green-700 dark:text-green-400`): replace with `bg-success/15 text-success`.

  Find line 311 (`bg-red-500/15 text-red-700 dark:text-red-400`): replace with `bg-destructive/15 text-destructive`.

  ```bash
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

  Commit: `fix(ui): use success/destructive tokens for version diff pill colors`

- [ ] **U1-T3 — profile-form.tsx inline feedback colors**

  Open `src/components/account/profile-form.tsx`.

  Find line 62 (`role="status" className="text-green-700 text-sm"`): replace `text-green-700` with `text-success`.

  Find line 67 (`role="alert" className="text-red-700 text-sm"`): replace `text-red-700` with `text-destructive`.

  ```bash
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

  Commit: `fix(ui): use success/destructive tokens for profile-form inline feedback`

---

### U2 — Cover-banner bottom hairline

**File:** `src/components/pages/cover-banner.tsx`

**Why:** All four cover variants (`preset`, `color`, `unsplash`, `upload`) render a `cairn-cover h-[200px] w-full` element that butts flush against the white page body. When a light-colored preset or solid-color cover is used in light mode, there is no visual separation — the cover and the page merge into one undifferentiated rectangle. A 1px `border-b border-border` resolves this without affecting the title (which is in normal block flow below, confirmed by Plan C C5 no-op finding).

**A11y note:** `border-b` is purely decorative; `aria-hidden="true"` is already set on all decorative cover variants. No change needed to ARIA.

- [ ] **U2-T1 — Add `border-b border-border` to all four CoverBanner variants**

  Open `src/components/pages/cover-banner.tsx`.

  For the **preset** variant (line ~32): change `className="cairn-cover h-[200px] w-full"` to `className="cairn-cover h-[200px] w-full border-b border-border"`.

  For the **color** variant (line ~44): same substitution.

  For the **unsplash** variant (line ~54): the outer `<div data-cairn-cover="" className="cairn-cover h-[200px] w-full overflow-hidden">` — add `border-b border-border` to that `className`.

  For the **upload** variant (line ~66): same as unsplash.

  ```bash
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

  Confirm: `EditableCover` wraps `CoverBanner` — no second border is added because `EditableCover` does not add its own `border-b`. Check `src/components/pages/editable-cover.tsx` to verify no double border.

  Commit: `fix(ui): add bottom hairline to cover banner to separate it from page body`

---

### U3 — Search palette entry animation

**File:** `src/components/search-palette.tsx`

**Why:** The `<Command>` container mounts instantly with no entry animation. The sheet, dropdowns, and dialogs all use `animate-in` utilities. The palette should match for a coherent micro-interaction language. `tw-animate-css` is already imported in `globals.css:2`; the utilities `animate-in fade-in-0 zoom-in-95 duration-150` are available. `prefers-reduced-motion` is respected automatically by `tw-animate-css`.

**A11y note:** The animation is purely decorative and is at the rubric-recommended 150ms. It does not change the element's interactivity, ARIA role, or focus management (cmdk handles focus trapping independently).

- [ ] **U3-T1 — Add `animate-in fade-in-0 zoom-in-95 duration-150` to Command container**

  Open `src/components/search-palette.tsx`.

  Locate the `<Command` element that is the outermost container of the palette UI (the element rendered when the palette is open). It will have `className` containing `bg-popover`, `border`, `shadow`, or similar.

  Add `animate-in fade-in-0 zoom-in-95 duration-150` to that element's `className`.

  ```bash
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

  Commit: `fix(ui): add entry fade+zoom animation to search palette (150ms, reduced-motion safe)`

---

### U4 — VERIFY-LIVE checks (no code — documentation gate)

**Why:** Two items from the audit require live runtime confirmation. This task records the expected outcome and gates on a redeploy; it does not require code changes.

- [ ] **U4-T1 — Document VERIFY-LIVE outcomes**

  After `ghcr.io/jonathanmcohen/cairn:v0.9.14` is deployed:

  - Audit item #5 (top-toolbar rows): open any page with content at a `1280px` viewport. If the `PageModeToggles` + `PageActionPanels` row and the editor control strip (`editor.tsx:596`) read as two visually competing toolbars → open a follow-up REFACTOR ticket for toolbar consolidation. If they read as one coherent row + one subordinate strip → mark SHIP-ALREADY.

  - Audit item #20 (mobile-narrow responsive): open the app at `375px` viewport. Verify the workspace `<Sidebar>` is hidden and the `<SidebarDrawer>` off-canvas toggle appears at 44px height. Verify overlay z-index does not conflict with the notification bell or search palette. If issues → open a follow-up P3 ticket.

  No code is expected. Document outcome in the PR description.

---

### U-GATE — Final verification

- [ ] **U-GATE-T1 — Full test suite**

  ```bash
  source ~/.zshenv && pnpm vitest run
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  source ~/.zshenv && pnpm build
  ```

  All must pass with 0 errors before marking the plan complete.

- [ ] **U-GATE-T2 — Visual diff review**

  Review diffs for `suggestions-drawer.tsx`, `version-history.tsx`, `profile-form.tsx`, `cover-banner.tsx`, `search-palette.tsx`. Confirm:
  - No interactive element has had its height or padding reduced.
  - No `aria-*` or `role=` attribute has been removed or altered.
  - No `dark:` dark-mode class has been left orphaned.
  - Cover `border-b border-border` appears on all four variants and is not duplicated in `EditableCover`.

- [ ] **U-GATE-T3 — No push**

  Do **not** push to remote. The controller/human merges all v0.9.14 plan branches into a single PR at the end of the release cycle per `docs/superpowers/plans/v0.9.14/scope.md` standing convention.
