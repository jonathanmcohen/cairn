# v0.9.14 Plan D — Suggest-edits drawer

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]). Prefix every shell command with `source ~/.zshenv && `.

## Goal

Verify — and lock in with regression tests — the two suggest-edits drawer items from the v0.9.14 scope. Both D1 and D2 were fully shipped in v0.9.13. **No new production code is required.** This plan's sole deliverable is a workflow-level regression test file that guards both behaviours so they cannot silently regress.

## Architecture

```
src/lib/suggestions/diff-preview.ts          ← pure fn: computeDiffPreview(doc, id) → {deleted, inserted}
src/components/editor/suggestions-drawer.tsx ← SuggestionCard renders <del>+<ins>; content region is <button onClick=onView>
src/components/editor/editor.tsx             ← viewSuggestion(): scrollIntoView + posAtDOM + setTextSelection + setDrawerOpen(false)
tests/suggestions/diff-preview.test.ts       ← unit tests for computeDiffPreview (5 cases — already passing)
tests/components/editor/suggestions-drawer.test.tsx  ← component tests including DEL/INS render + click-fires-onView (already passing)
tests/workflow/suggest-edits-drawer.spec.ts  ← NEW: workflow-level regression guard (this plan)
```

### D1 status: PRESENT

`src/lib/suggestions/diff-preview.ts` ships `computeDiffPreview()`. `suggestions-drawer.tsx` lines 49-75 render the diff as `<del className="... line-through ...">` and `<ins className="... no-underline ...">` when `s.diff` is set. Existing component test (`tests/components/editor/suggestions-drawer.test.tsx` lines 69-88) already asserts `del.tagName === 'DEL'` and `ins.tagName === 'INS'`. **No build required.**

### D2 status: PRESENT

`suggestions-drawer.tsx` lines 41-76 wrap the card's author line + diff preview in a `<button type="button" onClick={() => onView(s.id)}>`. Accept and Reject are sibling buttons outside that wrapper (no nested interactive elements). `editor.tsx` `viewSuggestion()` (lines 514-524):

1. Queries `[data-suggestion-id="${suggestionId}"]` on the editor DOM root.
2. Calls `el.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
3. Resolves `ed.view.posAtDOM(el, 0)` → `ed.chain().focus().setTextSelection(pos).run()`.
4. Calls `setDrawerOpen(false)`.

Existing component test (`tests/components/editor/suggestions-drawer.test.tsx` lines 106-149) already asserts card-click fires `onView` with the row id and that Accept does NOT fire `onView`. **No build required.**

## Tech Stack

- Vitest v4 + `@vitest-environment jsdom` (component-level assertions)
- `@testing-library/react` (render / fireEvent / screen)
- `src/lib/i18n/provider` + `messages/en.json` (same wrapper pattern as existing drawer tests)
- No Testcontainers — no DB needed

---

## Tasks

### D-T1 — Workflow regression: inline diff renders `<del>` + `<ins>` in suggestion cards (#118)

**Verdict: D1 is PRESENT. This task is a regression-test-only step.**

The existing `tests/components/editor/suggestions-drawer.test.tsx` already covers the unit rendering case. This task adds a workflow-scoped test in `tests/workflow/suggest-edits-drawer.spec.ts` that re-asserts the contract at the workflow level, ensuring no refactor silently removes the `<del>`/`<ins>` markup or strips the diff-preview block.

- [ ] Create `tests/workflow/suggest-edits-drawer.spec.ts` with `@vitest-environment jsdom` and the `I18nProvider` / `en` messages wrapper (same pattern as `tests/components/editor/suggestions-drawer.test.tsx`).

  The file should contain two `describe` blocks: one for D1 and one for D2 (added in D-T2 below). For D1, add three `it` cases:

  1. **`'D1 #118 — card renders <del> for deleted text and <ins> for inserted text'`**
     Render `<SuggestionsDrawer open suggestions={[{ id: 's1', authorName: 'Alice', diff: { deleted: 'original phrase', inserted: 'revised phrase' } }]} onAccept={() => {}} onReject={() => {}} onView={() => {}} onOpenChange={() => {}} />`.
     Assert `screen.getByText('original phrase').tagName === 'DEL'`.
     Assert `screen.getByText('revised phrase').tagName === 'INS'`.

  2. **`'D1 #118 — card renders only <ins> for insert-only suggestion'`**
     Render with `diff: { deleted: '', inserted: 'added text' }`.
     Assert `screen.getByText('added text').tagName === 'INS'`.
     Assert `screen.queryByRole('deletion')` is `null` (no `<del>` in the DOM).

  3. **`'D1 #118 — card omits diff block entirely when diff is absent'`**
     Render with `{ id: 's1', authorName: 'Alice' }` (no `diff` field).
     Assert `screen.queryByText(enMessages['pageActions.suggest.diffDeletedLabel'])` is `null`.
     Assert `screen.queryByText(enMessages['pageActions.suggest.diffInsertedLabel'])` is `null`.

- [ ] Run:
  ```sh
  source ~/.zshenv && pnpm vitest run tests/workflow/suggest-edits-drawer.spec.ts
  ```
  All three cases must pass green. If any fail, the feature is broken — stop, diagnose with `superpowers:systematic-debugging`, fix `suggestions-drawer.tsx`, then re-run.

- [ ] Commit:
  ```sh
  git add tests/workflow/suggest-edits-drawer.spec.ts
  git commit -m "test(workflow): D1 #118 regression — <del>/<ins> inline diff in suggestion cards"
  ```

---

### D-T2 — Workflow regression: card click scrolls to suggestion + selects it, closes drawer (#119)

**Verdict: D2 is PRESENT. This task is a regression-test-only step.**

`viewSuggestion` in `editor.tsx` already calls `scrollIntoView` + `posAtDOM` + `setTextSelection` + `setDrawerOpen(false)`. The existing component test confirms the click propagation contract at the `SuggestionsDrawer` boundary. This task extends `tests/workflow/suggest-edits-drawer.spec.ts` with a second `describe` block that validates the full `onView` behavioural contract from the drawer's perspective.

- [ ] In the same `tests/workflow/suggest-edits-drawer.spec.ts` file, add a `describe('D2 #119 — card click fires onView and NOT onAccept/onReject', ...)` block with four `it` cases:

  1. **`'clicking the card content region fires onView with the correct suggestion id'`**
     Render with two rows `[{ id: 's1', authorName: 'Alice' }, { id: 's2', authorName: 'Bob' }]`.
     `fireEvent.click(screen.getByRole('button', { name: /Alice/ }))`.
     Assert `onView` called once with `'s1'`.
     Assert `onView` not called with `'s2'`.

  2. **`'clicking Accept fires onAccept but NOT onView'`**
     Single row `{ id: 's1', authorName: 'Alice' }`.
     `fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.suggest.accept'] }))`.
     Assert `onAccept` called with `'s1'`.
     Assert `onView` not called.

  3. **`'clicking Reject fires onReject but NOT onView'`**
     Single row `{ id: 's1', authorName: 'Alice' }`.
     `fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.suggest.reject'] }))`.
     Assert `onReject` called with `'s1'`.
     Assert `onView` not called.

  4. **`'clicking the View in doc button also fires onView'`**
     Single row `{ id: 's1', authorName: 'Alice' }`.
     `fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.suggest.viewInDoc'] }))`.
     Assert `onView` called once with `'s1'`.

- [ ] Run:
  ```sh
  source ~/.zshenv && pnpm vitest run tests/workflow/suggest-edits-drawer.spec.ts
  ```
  All seven cases (three D1 + four D2) must pass green. If any fail, diagnose with `superpowers:systematic-debugging` before proceeding.

- [ ] Amend the commit from D-T1 or create a new commit:
  ```sh
  git add tests/workflow/suggest-edits-drawer.spec.ts
  git commit -m "test(workflow): D2 #119 regression — card click fires onView not accept/reject"
  ```

---

### D-GATE — Full suite verification

- [ ] Run the full suggest-related test corpus:
  ```sh
  source ~/.zshenv && pnpm vitest run tests/suggestions/ tests/components/editor/suggestions-drawer.test.tsx tests/components/editor/suggestion-toolbar.test.tsx tests/workflow/suggest-edits-drawer.spec.ts
  ```
  Zero failures required.

- [ ] Run the full Vitest suite and Biome:
  ```sh
  source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm vitest run
  ```
  Zero Biome errors. Zero type errors. Zero test failures.

- [ ] Report "Plan D GATE PASSED" to the controller. **Do not push.** The controller/human pushes at the end of the release.
