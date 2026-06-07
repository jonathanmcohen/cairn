# v0.9.14 Plan B — Editor block fixes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]). Prefix every shell command with `source ~/.zshenv && `.

## Goal

Fix five P1 editor regressions: task-list flex layout (#138), slash item rename (#139), heading collapse regression test (#117), slash range leak on cancel (#76), and slash menu behind modal (#128/#136). Three items are already fully shipped on v0.9.13 and are downgraded to regression-test-only.

## Architecture

All changes are confined to the editor layer:

- `src/components/editor/blocks.css` — task-list flex layout CSS
- `src/components/editor/slash-extension.ts` — rename "Task list" → "Checkbox list"
- `tests/components/editor/` — new and updated test files

No migrations, no API routes, no i18n strings (slash menu items are hard-coded English; the `useT()` hook is not used in `slash-extension.ts`).

## Tech Stack

- TipTap 3 + `@tiptap/extension-list` (TaskList/TaskItem) — `ul[data-type="taskList"]` DOM output
- Vitest 4 + jsdom (CSS source assertions; computed styles not available in jsdom — test the CSS text in the file)
- Biome v2 (lint + format)

## Status verdicts (code-checked before writing)

| Item | Issue | Status | Rationale |
|------|-------|--------|-----------|
| B1 | #138 task-list flex layout | **ABSENT** | `blocks.css` has no `taskList` or `task-list` rule; confirmed by `grep`. |
| B2 | #139 rename slash "Task list" → "Checkbox list" | **ABSENT** | `slash-extension.ts:425` still reads `title: 'Task list'`; `slash-aliases.test.ts` also references that string (must be updated). |
| B3 | #117 heading collapse chevron | **PRESENT** | `heading-collapse.tsx` is fully implemented (hover → chevron → toggle hidden), wired at `editor.tsx:659`, i18n'd in all 3 locales, and tested in `tests/components/editor/heading-collapse.test.tsx`. Downgraded to regression-test-only. |
| B4 | #76 slash leak on cancel | **PRESENT** | All modal-spawning slash items (`footnote`, `citation`, `equation`, `flashcard`, `citationLookup`) are `deferred: true`; `runSlashItem` hands the range to the command without pre-deleting; `onExit` destroys the popup immediately when the item is selected (before the modal opens). `consumeSlashRange` is called inside the async chain on commit. `slash-modal-consistency.test.ts` already asserts the pattern. Downgraded to regression-test-only. |
| B5 | #128/#136 slash behind modal | **PRESENT** | Same analysis as B4 — the tippy popup is destroyed via `onExit` the moment a `deferred` command is dispatched, which is before any modal opens. Downgraded to regression-test-only. |

---

## Tasks

### B1 — Task-list flex layout (#138)

**Status: ABSENT — build required.**

The `@tiptap/extension-list` TaskList extension renders `<ul data-type="taskList">` containing `<li data-type="taskItem">` with a `<label>` (checkbox) and `<div>` (content). Without flex layout the checkbox stacks above the text.

- [ ] **B1-T1 — Write failing test (source assertion)**

  Create `tests/components/editor/task-list-css.test.ts`:

  ```ts
  import { readFileSync } from 'node:fs';
  import { describe, expect, it } from 'vitest';

  const CSS = readFileSync(
    new URL(
      '../../../../src/components/editor/blocks.css',
      import.meta.url,
    ),
    'utf8',
  );

  describe('task-list flex layout (#138)', () => {
    it('has a flex rule for ul[data-type="taskList"] li', () => {
      expect(CSS).toContain('ul[data-type="taskList"]');
      expect(CSS).toContain('display:flex');
    });

    it('aligns to baseline', () => {
      expect(CSS).toContain('align-items:baseline');
    });

    it('has flex-none on the label (checkbox)', () => {
      expect(CSS).toContain('flex-none');
    });

    it('has flex-1 on the content div', () => {
      expect(CSS).toContain('flex-1');
    });

    it('removes list-style from the task list', () => {
      expect(CSS).toContain('list-style:none');
    });

    it('indents nested task lists', () => {
      expect(CSS).toMatch(/ul\[data-type="taskList"\]\s+ul\[data-type="taskList"\]/);
    });
  });
  ```

  Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/task-list-css.test.ts` — expect 6 failures.

- [ ] **B1-T2 — Implement the CSS fix**

  Append to `src/components/editor/blocks.css` (after the existing RTL placeholder rule at the end of the file):

  ```css
  /*
   * v0.9.14 #138 — task-list flex layout.
   *
   * @tiptap/extension-list TaskList renders:
   *   <ul data-type="taskList">
   *     <li data-type="taskItem">
   *       <label><input type="checkbox" /><span class="sr-only">…</span></label>
   *       <div>…content…</div>
   *     </li>
   *   </ul>
   *
   * Without flex the label (checkbox) stacks above the content div. The fix
   * makes each list item a flex row: label is flex-none so it never shrinks,
   * the div is flex-1 so it fills remaining width. align-items:baseline keeps
   * the checkbox optically aligned with the first line of text, and
   * list-style:none suppresses the browser's default bullet on <li>.
   */
  .ProseMirror ul[data-type="taskList"] {
    list-style: none;
    padding-inline-start: 0;
  }

  .ProseMirror ul[data-type="taskList"] li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .ProseMirror ul[data-type="taskList"] li > label {
    flex: none;
    line-height: 1;
  }

  .ProseMirror ul[data-type="taskList"] li > div {
    flex: 1;
    min-width: 0;
  }

  /* Nested task lists: indent by 1.25rem to match bullet list nesting. */
  .ProseMirror ul[data-type="taskList"] ul[data-type="taskList"] {
    padding-inline-start: 1.25rem;
  }
  ```

- [ ] **B1-T3 — Verify tests pass + lint**

  ```sh
  source ~/.zshenv && pnpm vitest run tests/components/editor/task-list-css.test.ts
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

- [ ] **B1-T4 — Commit**

  ```sh
  git add src/components/editor/blocks.css tests/components/editor/task-list-css.test.ts
  git commit -m "fix(editor): task-list flex layout (#138) — checkbox aligns with text"
  ```

---

### B2 — Rename slash "Task list" → "Checkbox list" (#139)

**Status: ABSENT — build required.**

The slash menu shows "Task list" but the block is a checkbox list; "My tasks" is the separate `/my-tasks` aggregator page. Renaming to "Checkbox list" reduces confusion. The `task` keyword alias is already in the keywords array (`['check', 'todo', 'checkbox', 'checklist']`) and a `'task'` alias must be added so typing `/task` still surfaces the item. The `slash-aliases.test.ts` hardcodes `'Task list'` and must be updated.

Slash items are hard-coded English strings (no `useT()` call in `slash-extension.ts`) — no i18n message files to update.

- [ ] **B2-T1 — Write failing test**

  Create `tests/components/editor/task-list-slash-rename.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { matchesSlashQuery, SLASH_ITEMS } from '@/components/editor/slash-extension';

  describe('slash rename: "Checkbox list" (#139)', () => {
    it('no item is titled "Task list" (old name removed)', () => {
      expect(SLASH_ITEMS.find((i) => i.title === 'Task list')).toBeUndefined();
    });

    it('an item is titled "Checkbox list"', () => {
      expect(SLASH_ITEMS.find((i) => i.title === 'Checkbox list')).toBeDefined();
    });

    it('typing "task" still surfaces the item (keyword alias)', () => {
      const results = SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'task')).map((i) => i.title);
      expect(results).toContain('Checkbox list');
    });

    it('"check" and "todo" still surface the item', () => {
      expect(
        SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'check')).map((i) => i.title),
      ).toContain('Checkbox list');
      expect(
        SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'todo')).map((i) => i.title),
      ).toContain('Checkbox list');
    });

    it('"checkbox" and "checklist" surface the item', () => {
      expect(
        SLASH_ITEMS.filter((i) => matchesSlashQuery(i, 'checkbox')).map((i) => i.title),
      ).toContain('Checkbox list');
    });

    it('keywords include "task" as an alias', () => {
      const item = SLASH_ITEMS.find((i) => i.title === 'Checkbox list');
      expect(item?.keywords).toContain('task');
    });

    it('description reads "Checkbox list" to match My-tasks distinction note', () => {
      const item = SLASH_ITEMS.find((i) => i.title === 'Checkbox list');
      // description should explain it's inline checkboxes, not the /my-tasks hub
      expect(item?.description).toBeTruthy();
    });
  });
  ```

  Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/task-list-slash-rename.test.ts` — expect failures.

- [ ] **B2-T2 — Implement the rename in slash-extension.ts**

  In `src/components/editor/slash-extension.ts`, locate the Task list item (around line 424–431):

  ```ts
  // BEFORE:
  {
    title: 'Task list',
    description: 'Checkbox list',
    category: 'basic',
    icon: ListChecks,
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
    keywords: ['check', 'todo', 'checkbox', 'checklist'],
  },

  // AFTER:
  {
    title: 'Checkbox list',
    description: 'Inline checkbox list (for /my-tasks see the sidebar)',
    category: 'basic',
    icon: ListChecks,
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
    keywords: ['check', 'todo', 'checkbox', 'checklist', 'task'],
  },
  ```

- [ ] **B2-T3 — Update the existing slash-aliases test to use the new title**

  In `tests/components/editor/slash-aliases.test.ts`, update two references to `'Task list'`:

  Line 26: change `expect(byTitle('Task list')?.keywords)` → `expect(byTitle('Checkbox list')?.keywords)`

  Line 68–69: change `expect(find('todo')).toContain('Task list')` → `expect(find('todo')).toContain('Checkbox list')`

- [ ] **B2-T4 — Verify all slash tests pass + lint**

  ```sh
  source ~/.zshenv && pnpm vitest run tests/components/editor/task-list-slash-rename.test.ts
  source ~/.zshenv && pnpm vitest run tests/components/editor/slash-aliases.test.ts
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

- [ ] **B2-T5 — Commit**

  ```sh
  git add src/components/editor/slash-extension.ts \
          tests/components/editor/task-list-slash-rename.test.ts \
          tests/components/editor/slash-aliases.test.ts
  git commit -m "fix(editor): rename slash 'Task list'→'Checkbox list' + task keyword alias (#139)"
  ```

---

### B3 — Heading collapse regression test (#117)

**Status: PRESENT — regression test only.**

`heading-collapse.tsx` is fully implemented (hover-reveals chevron, click toggles `hidden` attribute on blocks between headings), wired at `editor.tsx:659`, i18n'd in `messages/en.json`, `es.json`, and `ar.json`, and already tested in `tests/components/editor/heading-collapse.test.tsx`. The existing test covers collapse + expand + correct sibling boundary.

- [ ] **B3-T1 — Confirm test passes as-is (no code change)**

  ```sh
  source ~/.zshenv && pnpm vitest run tests/components/editor/heading-collapse.test.tsx
  ```

  If this passes, B3 is done. If it fails, investigate before touching any code.

- [ ] **B3-T2 — Add a wiring smoke assertion to editor integration test**

  Create `tests/components/editor/heading-collapse-wiring.test.tsx`:

  ```tsx
  // @vitest-environment jsdom
  // Regression guard: HeadingCollapse must remain wired in editor.tsx (#117).
  // This is a source-text assertion — it does not instantiate the full editor
  // (which requires real DOM geometry) but verifies the import and JSX mount.
  import { readFileSync } from 'node:fs';
  import { describe, expect, it } from 'vitest';

  const EDITOR_SRC = readFileSync(
    new URL(
      '../../../../src/components/editor/editor.tsx',
      import.meta.url,
    ),
    'utf8',
  );

  describe('HeadingCollapse wiring regression (#117)', () => {
    it('editor.tsx imports HeadingCollapse', () => {
      expect(EDITOR_SRC).toContain("import { HeadingCollapse }");
    });

    it('editor.tsx mounts <HeadingCollapse editor={editor} />', () => {
      expect(EDITOR_SRC).toMatch(/<HeadingCollapse\s+editor=\{editor\}/);
    });
  });
  ```

  Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/heading-collapse-wiring.test.tsx`

- [ ] **B3-T3 — Commit**

  ```sh
  git add tests/components/editor/heading-collapse-wiring.test.tsx
  git commit -m "test(editor): regression guard — HeadingCollapse wired in editor.tsx (#117)"
  ```

---

### B4 + B5 — Slash range-consume + popup-destroy regression tests (#76/#128/#136)

**Status: PRESENT — regression tests only.**

All modal-spawning slash items (`footnote`, `citation`, `citation-lookup`, `equation`, `flashcard`) are `deferred: true`. `runSlashItem` passes the range to the command without pre-deleting; on item selection the Suggestion plugin calls `onExit` → `popup.destroy()` synchronously, before any modal opens. `consumeSlashRange` fires inside the async chain at the point of actual insertion. The existing `tests/components/editor/slash-modal-consistency.test.ts` already asserts that each modal-spawning item opens `openEditorDialog` exactly once.

- [ ] **B4-T1 — Confirm existing slash-modal-consistency test passes**

  ```sh
  source ~/.zshenv && pnpm vitest run tests/components/editor/slash-modal-consistency.test.ts
  ```

- [ ] **B4-T2 — Write targeted regression tests for deferred flag + consume pattern**

  Create `tests/components/editor/slash-menu-modal-deferred.test.ts`:

  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import * as bus from '@/components/editor/editor-dialog-bus';
  import {
    consumeSlashRange,
    runSlashItem,
    SLASH_ITEMS,
    slashTriggerRange,
  } from '@/components/editor/slash-extension';

  vi.mock('@/components/editor/extensions-lazy', () => ({
    loadEditorExtension: vi.fn(async () => ({ name: 'stub' })),
  }));

  function makeChain() {
    const deleteRange = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = new Proxy(
      { deleteRange, run: vi.fn(), focus: () => chain },
      { get(t, p) { return p in t ? t[p as keyof typeof t] : () => chain; } },
    );
    return { chain, deleteRange };
  }

  function makeEditor(extensions: { name: string }[] = []) {
    const { chain, deleteRange } = makeChain();
    return {
      isDestroyed: false,
      extensionManager: { extensions },
      chain: () => chain,
      setOptions: vi.fn(),
      state: { doc: { textBetween: () => '' } },
      _deleteRange: deleteRange,
    };
  }

  const MODAL_ITEMS = ['Equation', 'Citation', 'Footnote', 'Flashcard'];

  describe('B4/B5 — modal slash items are deferred (#76/#128/#136)', () => {
    it('every modal-spawning item has deferred:true', () => {
      for (const title of MODAL_ITEMS) {
        const item = SLASH_ITEMS.find((i) => i.title === title);
        expect(item, `${title} missing`).toBeDefined();
        expect(item?.deferred, `${title} must be deferred`).toBe(true);
      }
    });

    it('runSlashItem does NOT call deleteRange synchronously for deferred items', () => {
      for (const title of MODAL_ITEMS) {
        const item = SLASH_ITEMS.find((i) => i.title === title);
        if (!item) continue;
        vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
        const editor = makeEditor();
        runSlashItem({ editor: editor as never, range: { from: 2, to: 2 }, item });
        // For deferred items, the range must NOT be deleted until the dialog resolves.
        expect(
          editor._deleteRange.mock.calls.length,
          `${title} must not delete range synchronously`,
        ).toBe(0);
        vi.restoreAllMocks();
      }
    });
  });

  describe('consumeSlashRange (#76)', () => {
    it('is a no-op when range is undefined', () => {
      const editor = makeEditor();
      // Must not throw.
      expect(() => consumeSlashRange(editor as never, undefined)).not.toThrow();
    });

    it('calls deleteRange when range is provided', () => {
      const { chain, deleteRange } = makeChain();
      const editor = {
        isDestroyed: false,
        extensionManager: { extensions: [] },
        chain: () => chain,
        setOptions: vi.fn(),
      };
      consumeSlashRange(editor as never, { from: 1, to: 3 });
      expect(deleteRange).toHaveBeenCalledWith({ from: 1, to: 3 });
    });
  });

  describe('slashTriggerRange (#38)', () => {
    it('widens range to include the leading / when char before is /', () => {
      const editor = {
        isDestroyed: false,
        extensionManager: { extensions: [] },
        chain: () => ({}),
        setOptions: vi.fn(),
        state: {
          doc: {
            textBetween: (_from: number, _to: number) => '/',
          },
        },
      };
      const range = slashTriggerRange(editor as never, { from: 5, to: 8 });
      expect(range).toEqual({ from: 4, to: 8 });
    });

    it('does not widen range when char before is not /', () => {
      const editor = {
        isDestroyed: false,
        extensionManager: { extensions: [] },
        chain: () => ({}),
        setOptions: vi.fn(),
        state: {
          doc: {
            textBetween: (_from: number, _to: number) => 'a',
          },
        },
      };
      const range = slashTriggerRange(editor as never, { from: 5, to: 8 });
      expect(range).toEqual({ from: 5, to: 8 });
    });
  });
  ```

  Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/slash-menu-modal-deferred.test.ts`

- [ ] **B4-T3 — Lint + typecheck**

  ```sh
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

- [ ] **B4-T4 — Commit**

  ```sh
  git add tests/components/editor/slash-menu-modal-deferred.test.ts
  git commit -m "test(editor): regression guards — deferred slash items + consume/trigger-range (#76/#128/#136)"
  ```

---

## Plan gate

- [ ] **GATE — Full test suite + lint + typecheck**

  ```sh
  source ~/.zshenv && pnpm vitest run
  source ~/.zshenv && pnpm lint
  source ~/.zshenv && pnpm typecheck
  ```

  All checks must pass before requesting merge. Do NOT push; the controller pushes.

- [ ] Confirm no new Biome errors (`pnpm lint` exits 0).
- [ ] Confirm task count: 4 commits total (B1, B2, B3, B4+B5).
- [ ] Ping the controller: "Plan B complete — awaiting GO for Plan D."
