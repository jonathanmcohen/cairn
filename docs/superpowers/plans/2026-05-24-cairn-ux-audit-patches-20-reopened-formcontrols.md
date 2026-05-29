# P20 (round 2) — Reopened Form Controls: #27 Due-by Date + #34 Create-Key Button

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This is a **round-2** plan: two issues were marked fixed in v0.9.3 but the deployed build still shows the defect. **Every task starts by diagnosing why the round-1 fix did not hold** — do not jump to a new fix until the diagnosis step is written down and confirmed against the real files.

**Goal:** Make the v0.9.3 round-1 fixes for **#27** (`/my-tasks` "Due by" date control) and **#34** (Developer settings "Create key" button) actually resolve the visual defect in the deployed build — by finding the true root cause each round-1 patch missed, then landing a durable fix.

**Why round 1 didn't hold (summary — confirmed by reading the files on this branch):**

- **#27** — Round-1 P01 (commit `65de12a`) swapped the native `<input type="date">` for the `ui/date-field` `DateField`. **But `DateField` itself still wraps a native `<input type="date">`** (`src/components/ui/date-field.tsx`), so the swap changed nothing the OS renders: the native calendar glyph + spinner chrome remain, and on most platforms the field still reads as a bare/unthemed native control. Re-skinning the wrapper `<Input>` cannot remove native picker chrome.
- **#34** — Round-1 P07 (commit `67dda09`) set `variant="default"` on the "Create key" button, and the subagent reported it was "already primary." It *was* — that's the point. `variant="default"` → `bg-primary`. The defect is in the **token chain, not the button**: the `default` accent (`html[data-accent="default"]` in `globals.css`) sets `--cairn-accent` but **never remaps `--primary`**, so `--primary` falls back to its base value — and in **dark mode** that base is `0 0% 98%` (near-white). A near-white pill with dark text reads as a "light-grey pill." Setting the variant again can never fix a token-level problem.

**Tech Stack:** React 19, `radix-ui` 1.4.3 (unified package — `Popover` lives here, no separate `@radix-ui/react-popover` install), Tailwind v4 (`@theme` in `src/app/globals.css`), `lucide-react`, `cn()` from `src/lib/utils.ts`, Biome v2, Vitest v4. i18n: any new user-visible string goes through the existing i18n layer (see `src/components/locale-switcher.tsx` / the `t()` usage pattern) — **no hard-coded English strings** in new UI.

**Constraints (apply to every task):**
- Reuse existing `ui/` primitives; only add a new primitive when none fits, and put it in `src/components/ui/`.
- New user-visible strings are i18n keys (en + es), never literals in JSX.
- WCAG 2.1 AA: visible focus ring (the global `:focus-visible` rule already provides 2px), and **44px minimum touch target** (`min-h-11`) on every interactive control this plan touches.
- Gate before each commit: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build` (UI changes ⇒ build is required), plus the task's vitest run.
- One commit per task, trailer `Closes #NN`.

**Covers:** GH #27 (reopened), #34 (reopened).

---

## Diagnose-first checklist (shared — referenced by all round-2 reopened plans)

> Other round-2 plans for the remaining reopened items (**#15, #17, #18, #19, #20, #29, #30, #39, #42, #44**) should open with this same checklist before touching code. Round-1 commits for those, for the diagnosing agent to `git show` first:
>
> | Issue | Round-1 commit | What round-1 claimed |
> |------|----------------|----------------------|
> | #15 | `b1c2d3e` | (verify with `git log --all --grep "#15"`) |
> | #17 | `c2d3e4f` | (verify with `git log --all --grep "#17"`) |
> | #18 | `d3e4f5a` | (verify with `git log --all --grep "#18"`) |
> | #19 | `e4f5a6b` | (verify with `git log --all --grep "#19"`) |
> | #20 | `f5a6b7c` | (verify with `git log --all --grep "#20"`) |
> | #29 | `a6b7c8d` | (verify with `git log --all --grep "#29"`) |
> | #30 | `b7c8d9e` | (verify with `git log --all --grep "#30"`) |
> | #39 | `c8d9e0f` | (verify with `git log --all --grep "#39"`) |
> | #42 | `d9e0f1a` | (verify with `git log --all --grep "#42"`) |
> | #44 | `e0f1a2b` | (verify with `git log --all --grep "#44"`) |
>
> **The commit hashes above are placeholders.** The diagnosing agent MUST resolve the real ones with `git log --all --grep "#NN"` / `git log --all --grep "Closes #NN"` and read the actual diff — never trust a hash from this table without confirming.

**The checklist — do all five before writing any fix:**

1. **Find the round-1 change.** `git log --all --grep "#NN"` → `git show <hash>`. Read exactly what it changed and what its commit message claimed.
2. **Read the current state of the affected file(s) on this branch.** Confirm the round-1 change is still present (it usually is — that's why "fixed it again" won't work). Quote the relevant lines in your write-up.
3. **Reproduce the defect's mechanism, not the symptom.** Ask: *which layer actually renders the pixels the audit complained about?* Common traps:
   - A wrapper component was themed but it delegates to a **native control** the OS paints (date/select/file inputs). → Restyling the wrapper is a no-op; you need a custom-rendered control or accept the native chrome explicitly.
   - The component is correct but a **design token** (`--primary`, `--accent`, `--border`…) resolves to the wrong value in the **active theme/accent/dark-mode combination**. → Fix the token chain in `globals.css`, not the component.
   - The **wrong instance** was fixed (multiple buttons/inputs with similar labels; the deployed page renders a different one). → Grep for *all* instances of the label/role and confirm which one the route actually renders.
   - The fix is correct in source but **gated/feature-flagged off** or shadowed by a more specific CSS rule (specificity / `!important` / inline style). → Inspect computed styles, not just the className string.
4. **State a single concrete hypothesis** ("the defect is X because layer Y renders Z under condition W") and name the exact file+line you'll change.
5. **Pick the durable fix** that makes the *mechanism* impossible, not the one that re-applies the symptom-level patch round 1 already tried.

---

### Task 1: #27 — Durable themed "Due by" date control on `/my-tasks`

**Files:**
- Modify: `src/components/ui/date-field.tsx`
- Modify: `src/app/(app)/my-tasks/tasks-table.tsx` (uses `DateField` at ~L76)
- Possibly create: `src/components/ui/popover.tsx` (only if you choose the popover-calendar route — see Step 2)
- Test: `tests/components/ui/date-field.test.tsx`

- [ ] **Step 1: DIAGNOSE — confirm why round-1 didn't hold**

  Run `git log --all --grep "#27"` and `git show 65de12a` (confirm the hash; resolve the real one if it differs). Confirm the round-1 diff swapped the native input in `tasks-table.tsx` for `DateField`.

  Then read `src/components/ui/date-field.tsx` as it stands on this branch. Confirm — and write into the task notes — that `DateField` renders:

  ```tsx
  <Input id={inputId} type="date" value={value} onChange={...}
         className="[color-scheme:light] dark:[color-scheme:dark]" />
  ```

  i.e. **a native `<input type="date">`**. The `[color-scheme]` utility only colors the native glyph; it does not remove or theme the native picker chrome. Conclusion to record: *the round-1 swap moved the native input behind a wrapper but did not replace it, so the audit's "unstyled native date input" is still literally a native date input.*

- [ ] **Step 2: HYPOTHESIS + decide the durable fix**

  Hypothesis (record it): *The control reads as native because `DateField` is a thin restyle of a native `<input type="date">`; the only durable fix is to stop relying on native picker chrome.*

  Decide between two durable options and record the choice with one sentence of justification:

  - **Option A (preferred — lowest risk, fully themed):** Build a `Popover`-backed calendar. Add a `ui/popover.tsx` wrapper over `radix-ui`'s `Popover` (the unified `radix-ui` package already exports it — mirror the `Select` wrapper pattern in `src/components/ui/select.tsx`), and render a small month-grid calendar (pure React + `Intl`/`Date` math — no new dependency) inside it. The trigger is a themed `Button variant="outline"` showing the formatted date or a placeholder. This removes native chrome entirely and is dark-mode-correct because it uses `bg-popover`/`text-popover-foreground` tokens.
  - **Option B (only if A is over-scope for this patch):** Keep the native input but make it unambiguously *themed* — wrap it in the same bordered, `bg-background`, `rounded-md`, `min-h-11` shell as the `Select` trigger, add a leading `lucide-react` `Calendar` icon, and keep `[color-scheme]` so the glyph matches. This does **not** remove native chrome, so only choose it if the audit's complaint is "looks unstyled/bare," not "shows native OS picker."

  **Default to Option A.** Option B is the fallback if the calendar grid can't be landed cleanly within this task.

- [ ] **Step 3: Write the failing test**

  Update `tests/components/ui/date-field.test.tsx` to assert the durable contract. For **Option A** the rendered control is a button, not an `input[type=date]`:

  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { DateField } from '@/components/ui/date-field';

  afterEach(cleanup);

  describe('<DateField>', () => {
    it('renders an accessible, themed trigger (not a bare native date input)', () => {
      render(<DateField label="Due by" value="2026-05-24" onChange={() => {}} />);
      const trigger = screen.getByRole('button', { name: /due by/i });
      expect(trigger).toBeTruthy();
      // 44px touch target + themed surface
      expect(trigger.className).toMatch(/min-h-11/);
      expect(trigger.className).toMatch(/rounded-md/);
      // it must NOT delegate to a native date input
      expect(document.querySelector('input[type="date"]')).toBeNull();
    });

    it('shows the formatted value and a clear control', () => {
      render(<DateField label="Due by" value="2026-05-24" onChange={() => {}} />);
      expect(screen.getByRole('button', { name: /due by/i }).textContent).toContain('2026');
    });
  });
  ```

  (If Step 2 lands **Option B**, instead assert the native input is wrapped in a `min-h-11` themed shell with a calendar icon and keep the `input[type=date]` assertion — adjust the test to match the chosen contract.)

- [ ] **Step 4: Run it, confirm it fails**

  Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/date-field.test.tsx`
  Expected: FAIL (current `DateField` renders a native input + label, no button).

- [ ] **Step 5: Implement (Option A)**

  - Add `src/components/ui/popover.tsx` if it doesn't exist, wrapping `radix-ui`'s `Popover` (`import { Popover as PopoverPrimitive } from 'radix-ui'`), styled with `bg-popover text-popover-foreground rounded-md border shadow-md` — copy the structure/idioms from `src/components/ui/select.tsx` so the two primitives stay consistent.
  - Rewrite `DateField` to: keep the same public props (`label`, `value` (ISO `yyyy-mm-dd`), `onChange(value)`, `id?`, `className?`, `hideLabel?`) so `tasks-table.tsx` needs **no prop changes**. Render a `Button variant="outline"` trigger with `min-h-11`, a leading `Calendar` icon, and either the formatted `value` or the i18n placeholder. Inside the popover render a keyboard-navigable month grid (arrow keys move days; Enter selects) that calls `onChange` with the ISO string. Provide a "Clear" affordance that calls `onChange('')`.
  - `aria-label` on the trigger = the `label` prop so the existing `hideLabel`/`label="Due by"` call site stays accessible.
  - **i18n:** the placeholder ("Select a date"), the "Clear" label, and month/weekday names use `t()` keys / `Intl.DateTimeFormat(locale, …)` — no hard-coded English. Add the new keys to the en + es message catalogs (follow the pattern the locale files already use; grep for an existing key like `locale.label` to find the catalog path).

  Keep the call site in `tasks-table.tsx` as-is (it already passes `label="Due by" hideLabel value={...} onChange={...}`); only verify the `due` query-param behavior is preserved (empty string clears the param via the existing `setQuery({ due: next || null })`).

- [ ] **Step 6: Run the test, confirm it passes**

  Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/date-field.test.tsx`
  Expected: PASS. If `bg-popover`/`text-popover-foreground` are undefined, they already exist in `globals.css` (`--color-popover` / `--color-popover-foreground`, L62-63) — no token work needed.

- [ ] **Step 7: Gate + commit**

  Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/date-field.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
  Also run any `my-tasks` tests: `pnpm vitest run -t "tasks"`.
  Expected: all PASS, clean build.

  ```bash
  git add src/components/ui/date-field.tsx src/components/ui/popover.tsx \
          src/app/\(app\)/my-tasks/tasks-table.tsx \
          tests/components/ui/date-field.test.tsx \
          <i18n catalog files touched>
  git commit -m "fix(my-tasks): replace native date input with themed popover calendar — Closes #27"
  ```

---

### Task 2: #34 — "Create key" button reads as a light-grey pill

**Files:**
- Modify: `src/app/globals.css` (accent token chain — the real fix)
- Read-only confirm: `src/components/settings/api-keys-manager.tsx` (the button, ~L148-159), `src/components/ui/button.tsx`
- Test: a small vitest (or extend an existing settings test) asserting the button uses `variant="default"`; the token fix is verified visually + via the gate.

- [ ] **Step 1: DIAGNOSE — confirm why round-1 didn't hold**

  Run `git log --all --grep "#34"` and `git show 67dda09` (confirm/resolve the hash). The round-1 diff set `variant="default"` on the "Create key" button and the subagent noted it was "already primary."

  Read the current `src/components/settings/api-keys-manager.tsx`. Confirm — and record — that the "Create key" button at ~L148 is already:

  ```tsx
  <Button type="button" variant="default" className="min-h-11" onClick={...}>
    Create key
  </Button>
  ```

  So the button **is** primary. Read `src/components/ui/button.tsx`: `variant="default"` → `bg-primary text-primary-foreground`. The button is correct.

  Now grep for *other* "create"/"new key" buttons to rule out the "wrong instance" trap:

  ```bash
  source ~/.zshenv && grep -rn "Create key\|New key\|Create API key\|createKey\|new-key" src/
  ```

  Confirm `api-keys-manager.tsx` is the one the Developer settings route renders (there is also a "Create" submit button inside the form at ~L210, which is `variant` default too — note which the audit screenshot shows).

  Then inspect the **token chain** in `src/app/globals.css`:
  - `:root` `--primary: 240 5.9% 10%` (near-black) — fine in light.
  - `.dark` `--primary: 0 0% 98%` (near-**white**) — a near-white pill.
  - `html[data-accent="default"]` (L135) sets `--cairn-accent: #0f172a` but **does NOT set `--primary`** — unlike every *named* accent (`blue`/`indigo`/… each set `--primary`). So under the **default accent** the button's `bg-primary` resolves to the base `:root`/`.dark` value. In **dark mode + default accent** that is near-white ⇒ the reported "light-grey pill."

- [ ] **Step 2: HYPOTHESIS + durable fix**

  Hypothesis (record it): *The "Create key" button is correctly `variant="default"`; the defect is that under the **default accent in dark mode**, `--primary` resolves to `0 0% 98%` (near-white), because `html[data-accent="default"]` never binds `--primary` to the accent color the way named accents do. Re-setting the button variant (round 1) can't fix a token resolved at the theme layer.*

  Durable fix — make the `default` accent bind `--primary`/`--ring` to its accent color exactly like the named accents, so a primary button is a saturated, high-contrast accent pill in **both** light and dark mode:

  ```css
  html[data-accent="default"] {
    --cairn-accent: #0f172a;
    --primary: 222 47% 11%;        /* #0f172a as HSL — saturated dark slate */
    --primary-foreground: 0 0% 98%;
    --ring: 222 47% 11%;
  }
  ```

  This removes the dark-mode regression for the default accent (the button no longer inherits the near-white `.dark` `--primary`). Verify the chosen HSL for `#0f172a` (~`222 47% 11%`) and that `--primary-foreground` (near-white text) keeps **WCAG AA contrast** against it (it does — dark slate vs near-white is ~14:1). Record the contrast check.

  > Note: this is a foundation-level token fix — it fixes **every** primary button/control under the default accent, not just "Create key." That's intended and correct; #34's symptom is just the most visible instance. Do not narrow it to one button.

- [ ] **Step 3: Confirm the button stays primary (regression guard)**

  Add/extend a vitest that renders `ApiKeysManager` and asserts the "Create key" trigger carries the primary classes (`bg-primary`) and the 44px target (`min-h-11`). This locks the round-1 change in place so a future refactor can't silently downgrade the variant:

  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render, screen } from '@testing-library/react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { ApiKeysManager } from '@/components/settings/api-keys-manager';

  afterEach(cleanup);

  it('Create key button is a 44px primary button', () => {
    render(<ApiKeysManager initialKeys={[]} />);
    const btn = screen.getByRole('button', { name: /create key/i });
    expect(btn.className).toMatch(/bg-primary/);
    expect(btn.className).toMatch(/min-h-11/);
  });
  ```

  Run: `source ~/.zshenv && pnpm vitest run <this test file>` — confirm it passes against the current source (the button is already primary; the test guards it).

- [ ] **Step 4: Apply the token fix + verify visually**

  Edit `html[data-accent="default"]` in `globals.css` per Step 2. Then sanity-check the cascade: the named accents already set `--primary`, so they're unaffected; only the previously-unbound default accent changes. Confirm dark mode + default accent now renders a dark-slate pill (light text), not a near-white pill.

  (If a Storybook/preview or `pnpm dev` is available, eyeball `/settings` Developer tab in dark mode before vs after. Otherwise rely on the token reasoning + the AA contrast check recorded in Step 2.)

- [ ] **Step 5: Gate + commit**

  Run: `source ~/.zshenv && pnpm vitest run <settings test> && pnpm lint && pnpm typecheck && pnpm build`
  Expected: PASS, clean build.

  ```bash
  git add src/app/globals.css tests/<settings test path>
  git commit -m "fix(theme): default accent binds --primary so primary buttons aren't near-white in dark mode — Closes #34"
  ```

---

## Self-Review

- **Diagnose-first:** Each task opens with a DIAGNOSE step that resolves the round-1 commit, reads current source, and identifies the *mechanism* (native control behind a wrapper for #27; unbound `--primary` token for #34) — not the symptom. ✓
- **Durable, not symptom-level:** #27 removes native picker chrome via a popover calendar (or, fallback, an unambiguously themed shell); #34 fixes the token chain so *all* default-accent primary controls are correct, instead of re-setting one button's variant. ✓
- **Reuses primitives:** `Popover` mirrors the existing `Select` wrapper; `Button variant="outline"`/`"default"` reused; tokens already exist in `globals.css`. ✓
- **i18n:** new date-picker strings (placeholder, Clear, month/weekday names) go through `t()` / `Intl` with en + es catalog keys — no literals. ✓
- **A11y:** `min-h-11` (44px) on every touched control; global `:focus-visible` ring; AA contrast of the new default-accent primary recorded. ✓
- **Gate + commits:** lint/typecheck/build + vitest before each commit; one commit per task with `Closes #27` / `Closes #34`. ✓
- **Shared checklist:** the diagnose-first checklist is reusable by the remaining reopened plans (#15,#17,#18,#19,#20,#29,#30,#39,#42,#44) with a commit-resolution table (placeholder hashes flagged as must-verify). ✓
- **Placeholders called out:** round-1 commit hashes in the shared table and the per-task DIAGNOSE steps are explicitly flagged as needing `git log --grep` confirmation. ✓
