# P32 — Editor Viewport Border-Glow Bug Hunt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:systematic-debugging — this is a diagnose-first bug hunt. Read the hypotheses, reproduce, instrument to confirm the offending element + class, THEN fix the confirmed cause. Do NOT skip to the fix. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate the faint orange/red glow that appears around the editor viewport (looks like a stuck focus / error state, reproduces after rapid slash-menu interaction) — GH #123 — without regressing the keyboard `:focus-visible` a11y ring.

**Symptom (from the issue):** A faint orange/red glow rings the editor viewport. It reads like a stuck focus or validation-error state. It reproduces reliably after *rapid* slash-menu (`/`) open/close interaction.

**Framing (systematic-debugging):** The "after rapid slash interaction" clue points at a focus/teardown interaction, not a static style. The slash popup is a tippy instance mounted on `document.body`; on `onExit` it destroys the popup and the React renderer, then focus returns to the `.ProseMirror` contenteditable. The leading suspect is that the returned focus lands in a `:focus-visible` state and the **global** `:focus-visible` outline (theme `--ring`) paints around the whole editor surface — and `--ring` is *orange* under the `amber` accent and *red/rose* under the `rose` accent. So the "glow" is the a11y ring rendered in an accent that happens to look like an error color, surfaced by a focus-return path the user can't otherwise trigger with the mouse.

**Tech Stack:** React 19, TipTap 3 (`@tiptap/react` `EditorContent` → `.ProseMirror` contenteditable), `@tiptap/suggestion` + `tippy.js` (slash menu), Tailwind v4 (`@theme` in `src/app/globals.css`, no config file), `next-themes` + per-user accent tokens.

**Covers:** GH #123.

---

## Background — the evidence already gathered (read before touching anything)

These are the facts a prior investigation pass turned up. Re-verify each in your own session; do not trust this list blind.

1. **Global `:focus-visible` outline uses `--ring`.** `src/app/globals.css` (~L97-108):

   ```css
   :focus-visible {
     outline: 2px solid hsl(var(--ring));
     outline-offset: 2px;
   }
   ```

   The `outline-offset: 2px` makes the ring sit *outside* the element edge — i.e. a "glow" around the viewport rather than a tight border.

2. **`--ring` is orange/red under two shipped accents.** `src/app/globals.css` (~L158-162, L153-157):

   ```css
   html[data-accent="amber"] { --ring: 32 95% 44%; }   /* hsl(32 95% 44%) ≈ #d97706 — orange */
   html[data-accent="rose"]  { --ring: 347 77% 50%; }  /* hsl(347 77% 50%) ≈ #e11d48 — red/rose */
   ```

   These are user-selectable accents (P19 ThemePicker / `user_theme_prefs`). A user on the amber or rose accent gets an orange/red ring everywhere `:focus-visible` matches.

3. **The editor surface only suppresses `:focus`, not `:focus-visible`.** `src/components/editor/editor.tsx` (~L197) sets the contenteditable class to:

   ```
   prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-hidden min-h-[50vh]
   ```

   Tailwind v4 `focus:outline-hidden` emits `:focus { outline-style: none; … }`. It does **not** target `:focus-visible`, so the global `:focus-visible { outline: 2px solid hsl(var(--ring)) }` still wins when the editor is in a `:focus-visible` state. The `min-h-[50vh]` makes the contenteditable tall, so its outline spans most of the viewport — matching "around the editor viewport".

4. **The slash popup is a body-mounted tippy that destroys on exit and returns focus to the editor.** `src/components/editor/slash-extension.ts` (~L558-599): `onStart` mounts `tippy(document.body, …)`; the suggestion `command` (~L552-555) runs `editor.chain().focus().deleteRange(range).run()` then `props.command(editor)`; `onExit` (~L594-597) calls `popup.destroy()` + `component.destroy()`. Programmatic `.focus()` *after* a keystroke is exactly the case the browser's `:focus-visible` heuristic resolves to "visible" (keyboard-originated focus), so the returned focus paints the global ring. Rapid open/close exercises this path repeatedly.

**Top hypothesis:** the orange/red glow is the **global `:focus-visible` outline rendered in the `amber`/`rose` accent `--ring` color**, painted around the `.ProseMirror` contenteditable when slash-menu teardown returns keyboard-style focus to the editor. It is not an error/validation style and not a tippy theme border. Confirm before fixing.

---

### Task 1: Reproduce + lock down the trigger

**Files:** none yet (investigation only).

- [ ] **Step 1: Run the app on the audit branch**

  Run: `source ~/.zshenv && pnpm dev` and open a page with the editor (`/pages/<id>`).

  Note: do NOT switch branches; stay on `patches/ux-audit-v0.9.4`.

- [ ] **Step 2: Set the accent to `amber` (then `rose`) and reproduce**

  In DevTools console, force the accent that the top hypothesis predicts is the culprit:

  ```js
  document.documentElement.setAttribute('data-accent', 'amber');
  ```

  Then in the editor: type `/`, watch the slash menu appear, press `Escape` or pick an item, and repeat rapidly (open/close `/` ~5-10× quickly). Confirm the faint orange ring appears around the editor viewport and persists.

  - [ ] Repeat with `data-accent="rose"` → expect the same glow but red.
  - [ ] Set `data-accent="default"` (or `slate`/`blue`) → expect the glow to be the neutral/blue ring, i.e. NOT read as an "error". This confirms the color is accent-driven, not a hardcoded red/orange error token.

- [ ] **Step 3: Record the repro state**

  Write down: which accent(s) reproduce it, whether the glow appears on a *single* slash open/close or only after *rapid* repeats, and whether clicking elsewhere (blur) clears it. (Expectation: it clears on real blur but the focus-return after teardown re-arms `:focus-visible`.)

  If the glow does NOT reproduce under any accent change → the top hypothesis is wrong; jump to **Fallback Hypotheses** below before continuing.

---

### Task 2: Instrument — confirm the exact element + offending rule

**Files:** none yet (investigation only).

- [ ] **Step 1: Identify the glowing element**

  With the glow visible, in DevTools Elements panel hover/select the editor and find the element whose computed box the ring traces. Expectation: it is the `.ProseMirror` contenteditable rendered by `EditorContent` (`src/components/editor/editor.tsx` L522), the element carrying the `prose … focus:outline-hidden min-h-[50vh]` class.

  Confirm in the **Computed** tab that `outline` resolves to `2px solid <orange/red>` and `outline-offset: 2px`, and in the **Styles** tab that the winning rule is the global `:focus-visible { outline: … }` from `globals.css` — NOT a `focus:outline-hidden` utility, NOT a `box-shadow`, NOT a `border-*`.

- [ ] **Step 2: Confirm it is `:focus-visible`, not `:focus`**

  In the DevTools Styles pane use "Toggle Element State" → force `:focus-visible` on the `.ProseMirror` element. The glow should appear/stay. Toggle it off → glow clears. This proves the surface is in a *focus-visible* state (not merely `:focus`), which is why `focus:outline-hidden` does not suppress it.

- [ ] **Step 3: Rule out the alternates quickly (so the fix is scoped to the real cause)**

  - [ ] grep confirms no orange/red `box-shadow`/`ring-*` utility on the editor wrapper: `source ~/.zshenv && grep -rniE "ring-|box-shadow|shadow-" src/components/editor` — expect only `presence-avatars.tsx` ring (avatar borders, unrelated) and `gallery.tsx` `focus:ring-2 focus:ring-ring` (image tiles, not the viewport).
  - [ ] `.suggestion-block[data-kind="delete"]` uses `var(--destructive)` (`code-highlight.css` ~L159) — this is a left *border* on a track-changes block, 3px inline-start only, NOT a viewport-spanning ring. Confirm the glowing element is NOT a `.suggestion-block` (check it has no `data-suggestion-block` attr).
  - [ ] tippy default theme (`tippy.js/dist/tippy.css`, imported in `src/app/layout.tsx` L10) adds no orange border; confirm no `.tippy-box` element is even present in the DOM once the glow shows (the popup is destroyed by `onExit`).
  - [ ] No `aria-invalid`/validation style is in play on the editor (grep `aria-invalid` in `src/components/editor` → none on the surface).

  If any alternate turns out to be the real winning rule in the Styles pane, switch to the matching **Fallback Hypothesis** and adapt the fix in Task 3.

---

### Task 3: Fix — scope the editor's focus treatment off the global accent ring

**Files:**
- Modify: `src/components/editor/editor.tsx` (~L197 — the contenteditable `class`)
- Test: `tests/components/editor/editor-focus-ring.test.tsx` (new)

**Rationale:** The contenteditable is a *large surface*, not a discrete control. A 2px accent outline offset 2px around a 50vh box is the glow. The global `:focus-visible` ring exists for discrete focusable controls (buttons, inputs, links) per WCAG 2.4.7 — it should NOT paint a viewport-sized ring around the writing surface. The contenteditable already shows the caret as its focus affordance, so suppressing the *outline* on this one element is correct and does not regress real control focus rings elsewhere.

- [ ] **Step 1: Write the failing test**

  ```tsx
  // @vitest-environment jsdom
  import { cleanup, render } from '@testing-library/react';
  import { afterEach, describe, expect, it } from 'vitest';
  import { Editor } from '@/components/editor/editor';
  // NOTE: import path / props — read editor.tsx's actual default/named export and
  // required props (pageId, initialContent, role, etc.) IN-FILE first and wire a
  // minimal valid render. If a full <Editor> render is too heavy for jsdom (Yjs
  // provider, lazy extensions), instead assert on the *class string* the editor
  // applies to the contenteditable by extracting it to an exported constant
  // (see Step 2) and unit-testing that constant. Prefer the constant test — it is
  // deterministic and fast.

  afterEach(cleanup);

  describe('editor contenteditable focus treatment', () => {
    it('suppresses the focus-visible outline on the writing surface', () => {
      // Asserts the class list neutralizes the global :focus-visible ring on the
      // large editor surface (so the accent ring can't paint a viewport glow),
      // while leaving discrete-control focus rings untouched elsewhere.
      const cls = EDITOR_CONTENT_CLASS; // exported constant from editor.tsx
      expect(cls).toContain('focus-visible:outline-hidden');
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails**

  Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/editor-focus-ring.test.tsx`
  Expected: FAIL — `EDITOR_CONTENT_CLASS` not exported / class lacks `focus-visible:outline-hidden`.

- [ ] **Step 3: Apply the fix**

  In `src/components/editor/editor.tsx`, the contenteditable class currently is (~L197):

  ```
  'prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-hidden min-h-[50vh]'
  ```

  Add `focus-visible:outline-hidden` so the editor surface no longer renders the global accent `:focus-visible` outline (Tailwind v4 emits `:focus-visible { outline-style: none }`, which beats `globals.css`'s `:focus-visible { outline: 2px … }` by source order if the editor stylesheet/utility layer loads after `@layer base`; verify cascade in DevTools after the change — if base still wins, see Step 3a):

  ```
  'prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-hidden focus-visible:outline-hidden min-h-[50vh]'
  ```

  To keep the change DRY and testable, extract the string to an exported module-level constant and reference it:

  ```tsx
  export const EDITOR_CONTENT_CLASS =
    'prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-hidden focus-visible:outline-hidden min-h-[50vh]';
  ```

  …then use `class: EDITOR_CONTENT_CLASS` in `editorProps.attributes`.

  - [ ] **Step 3a (only if DevTools shows the global base rule still wins):** Tailwind utilities live in `@layer utilities`, which beats `@layer base`, so `focus-visible:outline-hidden` should win. If for any reason it does not (e.g. specificity tie resolved toward base), scope the *global* rule instead so it excludes the editor surface, in `src/app/globals.css`:

    ```css
    :focus-visible:not(.ProseMirror) {
      outline: 2px solid hsl(var(--ring));
      outline-offset: 2px;
    }
    ```

    Prefer the utility approach (Step 3) over editing the global rule; only fall back to this if the cascade demands it. Either way the constraint holds: discrete controls keep their ring; only the large editor surface loses the viewport glow.

- [ ] **Step 4: Run the test, confirm it passes**

  Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/editor-focus-ring.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Manually re-verify the repro is gone AND a11y is intact**

  With `pnpm dev` running and `data-accent="amber"`:
  - [ ] Repeat the rapid `/` open/close from Task 1 → confirm NO orange glow around the editor viewport.
  - [ ] Tab to a discrete control (a toolbar button, the Outline toggle, a link) → confirm the keyboard `:focus-visible` ring STILL renders (regression guard for WCAG 2.4.7). The editor surface itself relies on the caret as its focus affordance, which is unchanged.
  - [ ] Repeat under `data-accent="rose"` and `data-accent="default"`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/editor/editor.tsx tests/components/editor/editor-focus-ring.test.tsx
  git commit -m "fix(editor): drop viewport-spanning focus-visible ring on writing surface — Closes #123"
  ```

---

### Task 4: Gate — lint / typecheck / build

**Files:** none (verification).

- [ ] **Step 1: Full gate**

  Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
  Expected: clean. (Biome may reorder the new import / reflow the constant — accept its autofix.)

  If anything is red, fix forward; do not weaken the test.

---

## Fallback Hypotheses (use only if Task 2 disproves the top hypothesis)

Work these in order. Each names the suspect, where to look, how it would explain "after rapid slash interaction", and the fix shape. Confirm with the Styles pane (which rule actually wins) before changing code.

- [ ] **FB-1 — tippy popup not torn down on rapid open/close (leaked instance / stuck reference).**
  `src/components/editor/slash-extension.ts` `onExit` (~L594) calls `popup.destroy()` once. On rapid open/close, `onStart` can fire a new instance while a prior `onExit`/`destroy` is in flight; a leaked `.tippy-box`/popper on `document.body` could carry the default tippy border or hold an `aria-expanded`/focus state on the reference. **Check:** after the glow shows, search the DOM for orphan `[data-tippy-root]`/`.tippy-box` nodes (`document.querySelectorAll('[data-tippy-root]')`). **Fix shape:** guard teardown — null-check + idempotent destroy, e.g. `if (popup && !popup.state.isDestroyed) popup.destroy();` and clear refs; consider `popup.hide()` before `destroy()` and removing the `keydown` listener (mirror the `openPagePicker` close path which already removes its listener). Also audit the sibling popups (`page-link-suggestion.ts`, `mention-extension.ts`, `page-link-extension.ts`) for the same race if they share the body-mount pattern.

- [ ] **FB-2 — `focus-within` / ring on an editor wrapper that survives popup teardown.**
  grep for `focus-within` across `src/components/editor` and the page shell that wraps `<Editor>` (the wrapper `<div className="relative">` in `editor.tsx` L474, and the route layout). If a wrapper has `focus-within:ring-*`/`focus-within:outline` and the body-mounted tippy is (or was) a focus descendant via aria, rapid teardown could leave the wrapper matching `:focus-within` transiently. **Fix shape:** remove/scope the `focus-within` ring, or ensure focus returns cleanly to the contenteditable so `:focus-within` resolves correctly.

- [ ] **FB-3 — track-changes / suggestion-block destructive border bleeding.**
  `.suggestion-block[data-kind="delete"]` → `border-inline-start-color: var(--destructive)` (`code-highlight.css` ~L159) and `--destructive: 0 84.2% 60.2%` (red, `globals.css` ~L27). If suggestion mode was toggled and a delete-block wraps the whole document, its 3px red left border could read as a partial glow. **Check:** is the glowing element a `.suggestion-block`? Is suggestion mode on? **Fix shape:** scope the destructive border so it cannot wrap the full editor / only applies to the intended inline-start edge; this is unrelated to slash teardown, so this hypothesis is weak given the repro clue.

- [ ] **FB-4 — `aria-invalid` / validation style.**
  grep `aria-invalid` / `data-invalid` in `src/components/editor` and any shared input styles applied to `[contenteditable]`. If a global `[aria-invalid] { outline/box-shadow: … destructive }` exists and the editor transiently gets `aria-invalid`, that would be a true "error state" glow. **Check:** does the surface ever carry `aria-invalid`? (Expected: no.) **Fix shape:** stop setting `aria-invalid` on the editor, or scope the invalid style off the contenteditable.

- [ ] **FB-5 — leftover `:focus` ring on `contenteditable` from a global rule.**
  Confirm in DevTools whether a `[contenteditable]:focus` or `.ProseMirror:focus` rule (in any of the editor CSS files) sets an outline/box-shadow. grep: `source ~/.zshenv && grep -rniE "contenteditable|ProseMirror.*:focus|:focus" src/components/editor/*.css`. **Fix shape:** scope/remove that rule. (blocks.css L11 only does `outline: none` on a selected `hr` — not a glow source.)

---

## Self-Review

- Diagnose-first: Tasks 1-2 reproduce + confirm the exact element and winning rule before any edit (systematic-debugging). ✓
- Top hypothesis is concrete (global `:focus-visible` ring × amber/rose accent `--ring`, surfaced by slash-teardown focus-return) and is falsifiable in Task 1 Step 2. ✓
- Fix is scoped to the large editor surface only; discrete-control `:focus-visible` rings are explicitly regression-guarded (Task 3 Step 5, WCAG 2.4.7). ✓
- Fallbacks cover tippy teardown race (FB-1), wrapper `focus-within` (FB-2), suggestion-block destructive (FB-3), `aria-invalid` (FB-4), and a leftover contenteditable `:focus` rule (FB-5) — the suspect list from the issue. ✓
- Gate: lint + typecheck + build before done; commit trailer `Closes #123`. ✓
- No git add/commit/push performed by the planner; commit commands are for the executing session. ✓
