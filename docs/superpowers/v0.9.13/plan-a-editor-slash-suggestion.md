# v0.9.13 Plan A — Editor slash cleanup + clickable suggestion card

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax. One task at a time: failing test → confirm fail → minimal impl → confirm pass → commit. Controller/human pushes. Prefix every shell command with `source ~/.zshenv && `.

## Goal

Fix three browser-verified bugs on `patches/v0.9.13`:

1. **#76 + #136 (one fix):** `citationMenuItem.run()` and `footnoteMenuItem.run()` open a dialog without calling `popup.destroy()`, so the slash popup stays visible behind the modal (#136). On cancel, `consumeSlashRange` is never called, so the typed `/citation` or `/footnote` text leaks into the block (#76). Fix both items to: (a) call `popup.destroy()` immediately on open (mirror `openPagePicker` and the flashcard item), and (b) call `consumeSlashRange` on both the resolve path **and** the cancel/no-op path.

2. **#119:** The `<li>` card in `SuggestionsDrawer` (`suggestions-drawer.tsx:63`) has no `onClick`; only the three inner buttons (View, Accept, Reject) are interactive. Make the whole card container clickable to invoke `onView(s.id)`. Accept/Reject buttons must call `stopPropagation` so their handlers fire alone.

## Architecture

- **Slash fixes (#76 #136):** `src/components/editor/slash-extension.ts`. The `popup` instance lives in the `render()` closure of `SlashCommand.suggestion`; it is **not** accessible to the individual `CitationSlashEntry.run()` functions by design. The correct fix is to call `popup.destroy()` from inside `run()` — but `run()` has no reference to the popup. The pattern used by `openPagePicker` (and by the page-embed slash item) is to pass a `destroy` callback at call time, or to call a module-level side-effect. Reviewing the actual code: `citationMenuItem.run(editor, range)` is called from `toSlashItem()` via the `command` property on the `SlashItem`, which is called from `runSlashItem()` → `item.command(editor, range)`. The popup lives in the `render()` scope.

  The correct fix mirrors the **flashcard item** which calls `openEditorDialog(...)` — the popup is destroyed by TipTap's suggestion plugin when the command is dispatched (via `onExit` → `popup.destroy()`). Wait — checking the actual flow: `runSlashItem` calls `item.command(editor, range)` which for deferred items calls the command function directly (does **not** delete the range first). TipTap's suggestion plugin calls `onExit` automatically after the `command` callback fires, which calls `popup.destroy()` and `component.destroy()`. So the popup **is** already destroyed for flashcard/equation by the time the dialog opens.

  But for citation and footnote it is **not** destroyed because those items are flagged `deferred: true` yet call `openEditorDialog()` which returns a promise — the `command` callback returns before the dialog resolves. TipTap calls `onExit` immediately after `command` returns (since the suggestion text was deleted or the trigger was consumed). Actually, re-reading: for deferred items `runSlashItem` does NOT call `deleteRange` before `item.command` — it just calls `item.command(editor, range)`. The suggestion plugin's own `command` callback fires, then TipTap calls `onExit` right after (this is TipTap suggestion behavior: `onExit` fires when the suggestion text is deleted or the editor loses focus). The issue is that for deferred items the slash-range text is NOT deleted on open, so the suggestion plugin's exit hook may not fire until later.

  The scope doc confirms the root cause at `slash-extension.ts:187`: "doesn't `popup.destroy()` on open. Flashcard (#128) already does." The fix in `citationMenuItem.run` and `footnoteMenuItem.run` is to:
  - Accept `popup` as a parameter, OR
  - Accept a `destroyPopup` callback through the `CitationSlashEntry.run` signature, OR
  - Simply call `consumeSlashRange(editor, range)` eagerly (before the dialog) so TipTap's suggestion plugin sees the range gone and calls `onExit` which triggers `popup.destroy()`.

  The simplest pattern that mirrors the flashcard item: the flashcard slash item is defined inline in the `items` array (not as a `CitationSlashEntry`). Its `command` calls `openEditorDialog(...)` and the popup is destroyed by `onExit` after the suggestion command fires. The citation/footnote items go through `toSlashItem()` which wraps `CitationSlashEntry.run` as the `command`. Since the suggestion plugin calls `onExit` → `popup.destroy()` after any `command` callback returns — **for both sync and deferred items** — the popup should already be destroyed. But the scope doc says it isn't.

  On re-reading `runSlashItem`: for `deferred` items it calls `item.command(editor, range)` directly and returns. The TipTap suggestion plugin's own `command` is `({ editor, range, props }) => runSlashItem(...)`. After this callback returns, the suggestion plugin fires `onKeyDown` but does NOT automatically fire `onExit` — `onExit` fires when the suggestion text is no longer present in the document (i.e., the range is deleted). Since deferred items do NOT delete the range on open, `onExit` fires only after `consumeSlashRange` is called inside the `.then()` on resolve. **This is the bug**: the popup is never destroyed when the user opens the dialog (it hides behind the modal) and when the user cancels (range not consumed → popup never destroyed → stale popup).

  **Fix:** in `citationMenuItem.run()` and `footnoteMenuItem.run()`, call `consumeSlashRange(editor, range)` **before** opening the dialog (so the suggestion text is erased immediately and TipTap fires `onExit`/`popup.destroy()`), and on cancel (null result) restore nothing (the range is already gone — this is correct). On resolve, do NOT call `consumeSlashRange` again (already consumed). This matches how the `embed` and `synced-block` items work: they call `consumeSlashRange` before their async lazy-load. The citation/datetime/equation items are the outliers.

  The existing tests for cancel already check that `setMark` / insert is not called on cancel — they do not check range consumption. New tests will verify: (a) `consumeSlashRange` is called immediately (before dialog resolves); (b) on cancel, the range was still consumed (no leaked `/` text); (c) existing insert-on-resolve tests continue to pass.

- **Suggestion card click (#119):** `src/components/editor/suggestions-drawer.tsx:63`. Add `onClick={() => onView(s.id)}` and `role="button"` / `tabIndex={0}` / `onKeyDown` to the `<li>` container. Add `onClick={(e) => { e.stopPropagation(); onAccept(s.id); }}` and `onClick={(e) => { e.stopPropagation(); onReject(s.id); }}` on the Accept and Reject buttons. The View button already calls `onView` directly — it should also `stopPropagation` to avoid double-firing. Tests in `tests/components/editor/suggestions-drawer.test.tsx`.

## Tech Stack

- TypeScript 6 strict, React 19
- TipTap 3, `@tiptap/suggestion` plugin
- `tippy.js` (`Instance<TippyProps>`)
- `@testing-library/react`, Vitest 4, `jsdom`
- `src/lib/i18n/provider` (`useT`), `messages/en.json`
- Biome v2 (lint + format)

---

## File structure

| File | Role |
|---|---|
| `src/components/editor/slash-extension.ts` | Fix `citationMenuItem.run` and `footnoteMenuItem.run` |
| `src/components/editor/suggestions-drawer.tsx` | Add `<li>` container click handler + stopPropagation on buttons |
| `tests/components/editor/citation-slash.test.ts` | New tests: popup destroyed on open, range consumed on cancel |
| `tests/components/editor/suggestions-drawer.test.tsx` | New tests: card click fires `onView`; Accept does NOT double-fire |

---

## Tasks

---

### Task 1 — citation/footnote: consume slash range before dialog opens (#76 #136)

Fixes both issues in one edit: calling `consumeSlashRange` at the top of `run()` (before `openEditorDialog`) erases the suggestion text immediately, which triggers TipTap's `onExit` → `popup.destroy()`. On cancel the range is already gone (no leaked `/text`). On resolve the `consumeSlashRange` call inside the `.then()` becomes a no-op (range already deleted) — leave it for safety (the function is a safe no-op when range is already gone).

**Files touched:**
- `src/components/editor/slash-extension.ts`
- `tests/components/editor/citation-slash.test.ts`

#### Failing test (full code)

Replace the entire contents of `tests/components/editor/citation-slash.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bus from '@/components/editor/editor-dialog-bus';
import {
  citationMenuItem,
  consumeSlashRange,
  footnoteMenuItem,
} from '@/components/editor/slash-extension';

// stub lazy dynamic imports used inside the resolve paths
vi.mock('@/lib/citations/format', () => ({
  formatCitation: vi.fn(() => 'APA'),
}));
vi.mock('@/components/editor/extensions/citation', () => ({
  CitationExtension: { name: 'citation' },
}));
vi.mock('@/components/editor/blocks/footnote-mark', () => ({
  FootnoteMark: { name: 'footnote' },
}));

afterEach(() => {
  vi.restoreAllMocks();
  bus.resetEditorDialogBus();
});

function makeEditorStub() {
  const run = vi.fn();
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'run') return run;
        return () => chain;
      },
    },
  );
  return {
    isDestroyed: false,
    extensionManager: { extensions: [] as { name: string }[] },
    chain: () => chain,
    setOptions: vi.fn(),
    state: {
      doc: {
        textBetween: vi.fn(() => ''),
      },
    },
  };
}

describe('citation + footnote slash entries — basic shape', () => {
  it('/citation present', () => {
    expect(citationMenuItem.command).toBe('/citation');
    expect(typeof citationMenuItem.run).toBe('function');
  });
  it('/footnote present', () => {
    expect(footnoteMenuItem.command).toBe('/footnote');
    expect(typeof footnoteMenuItem.run).toBe('function');
  });
});

describe('citation slash — popup destroy + range leak fix (#76 #136)', () => {
  it('consumeSlashRange is called synchronously before the dialog resolves for citationMenuItem', () => {
    // The fix: consumeSlashRange must be called before openEditorDialog resolves
    // so that TipTap's onExit fires and the popup is destroyed immediately on open.
    vi.spyOn(bus, 'openEditorDialog').mockReturnValue(new Promise(() => {})); // never resolves
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = { focus: () => ({ deleteRange }) };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    citationMenuItem.run(editor as never, range);

    // consumeSlashRange calls editor.chain().focus().deleteRange(range).run()
    expect(deleteRange).toHaveBeenCalledWith(range);
  });

  it('consumeSlashRange is called synchronously before the dialog resolves for footnoteMenuItem', () => {
    vi.spyOn(bus, 'openEditorDialog').mockReturnValue(new Promise(() => {})); // never resolves
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = { focus: () => ({ deleteRange }) };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    footnoteMenuItem.run(editor as never, range);

    expect(deleteRange).toHaveBeenCalledWith(range);
  });

  it('on cancel (null result), citationMenuItem does NOT insert and range was already consumed', async () => {
    vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
    const insertContent = vi.fn();
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = {
      focus: () => ({ deleteRange, insertContent }),
    };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    citationMenuItem.run(editor as never, range);

    // Range consumed synchronously before dialog
    expect(deleteRange).toHaveBeenCalledWith(range);

    await new Promise((r) => setTimeout(r, 0));

    // No insert on cancel
    expect(insertContent).not.toHaveBeenCalled();
  });

  it('on cancel (null result), footnoteMenuItem does NOT set mark and range was already consumed', async () => {
    vi.spyOn(bus, 'openEditorDialog').mockResolvedValue(null);
    const setMark = vi.fn();
    const deleteRange = vi.fn(() => ({ run: vi.fn() }));
    const chain = {
      focus: () => ({ deleteRange, setMark }),
    };
    const editor = makeEditorStub();
    (editor as unknown as { chain: () => typeof chain }).chain = () => chain;

    const range = { from: 2, to: 10 };
    footnoteMenuItem.run(editor as never, range);

    expect(deleteRange).toHaveBeenCalledWith(range);

    await new Promise((r) => setTimeout(r, 0));

    expect(setMark).not.toHaveBeenCalled();
  });
});
```

#### Run to fail

```sh
source ~/.zshenv && pnpm vitest run tests/components/editor/citation-slash.test.ts
```

Expected: the two "consumeSlashRange is called synchronously" tests fail — `deleteRange` is not called before the dialog resolves in the current code.

#### Minimal implementation

Edit `src/components/editor/slash-extension.ts`.

In `footnoteMenuItem.run`:

**Before:**
```typescript
  run: (editor: Editor, range?: SlashRange): void => {
    void openEditorDialog({ kind: 'footnote', title: 'Footnote' }).then((raw) => {
      const result = asFormResult(raw);
      const content = result?.text;
      if (!content) return;
      if (editor.isDestroyed) return;
      consumeSlashRange(editor, range);
```

**After:**
```typescript
  run: (editor: Editor, range?: SlashRange): void => {
    consumeSlashRange(editor, range);
    void openEditorDialog({ kind: 'footnote', title: 'Footnote' }).then((raw) => {
      const result = asFormResult(raw);
      const content = result?.text;
      if (!content) return;
      if (editor.isDestroyed) return;
```

In `citationMenuItem.run`:

**Before:**
```typescript
  run: (editor: Editor, range?: SlashRange): void => {
    void openEditorDialog({ kind: 'citation', title: 'Citation' }).then((raw) => {
      const result = asFormResult(raw);
      if (!result) return;
      const author = result.author?.trim() ?? '';
      const title = result.title?.trim() ?? '';
      const year = Number.parseInt(result.year ?? '', 10);
      if (!author || !title || Number.isNaN(year)) return;
      const doi = result.doi?.trim() ? result.doi.trim() : null;
      const pubmed = result.pubmed?.trim() ? result.pubmed.trim() : null;
      const ref = { authors: [author], title, year };
      void Promise.all([
        import('@/lib/citations/format'),
        import('./extensions/citation').then((m) => m.CitationExtension),
      ]).then(([fmt, CitationExt]) => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
```

**After:**
```typescript
  run: (editor: Editor, range?: SlashRange): void => {
    consumeSlashRange(editor, range);
    void openEditorDialog({ kind: 'citation', title: 'Citation' }).then((raw) => {
      const result = asFormResult(raw);
      if (!result) return;
      const author = result.author?.trim() ?? '';
      const title = result.title?.trim() ?? '';
      const year = Number.parseInt(result.year ?? '', 10);
      if (!author || !title || Number.isNaN(year)) return;
      const doi = result.doi?.trim() ? result.doi.trim() : null;
      const pubmed = result.pubmed?.trim() ? result.pubmed.trim() : null;
      const ref = { authors: [author], title, year };
      void Promise.all([
        import('@/lib/citations/format'),
        import('./extensions/citation').then((m) => m.CitationExtension),
      ]).then(([fmt, CitationExt]) => {
        if (editor.isDestroyed) return;
        consumeSlashRange(editor, range);
```

Note: the second `consumeSlashRange(editor, range)` inside the `.then()` in `citationMenuItem` becomes a safe no-op (range already deleted). Leave it in place — `consumeSlashRange` is a no-op when range is undefined and is harmless when the range no longer exists in the doc.

#### Run to pass

```sh
source ~/.zshenv && pnpm vitest run tests/components/editor/citation-slash.test.ts
```

All tests in the file pass.

#### Commit

```sh
source ~/.zshenv && git add src/components/editor/slash-extension.ts tests/components/editor/citation-slash.test.ts && git commit -m "$(cat <<'EOF'
fix(editor): destroy slash popup and clear range on citation/footnote open (#76 #136)

consumeSlashRange is now called synchronously before openEditorDialog for
citationMenuItem and footnoteMenuItem, so the suggestion text is erased
immediately on menu selection (triggering TipTap's onExit → popup.destroy()).
On cancel, no insert fires and the range is already gone — no leaked /text.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 — clickable suggestion card container (#119)

Make the entire `<li>` card in `SuggestionsDrawer` clickable, invoking `onView(s.id)`. The View button, Accept button, and Reject button each call `stopPropagation` so the card-level click does not double-fire. Add `tabIndex={0}` and `onKeyDown` (Enter/Space → onView) for keyboard accessibility.

**Files touched:**
- `src/components/editor/suggestions-drawer.tsx`
- `tests/components/editor/suggestions-drawer.test.tsx`

#### Failing test (full code)

Append these two `it` blocks to the existing `describe('<SuggestionsDrawer> (#85/#145)', ...)` in `tests/components/editor/suggestions-drawer.test.tsx`:

```typescript
  it('#119 clicking the card body (not a button) fires onView with the row id', () => {
    const onView = vi.fn();
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={rows}
          onAccept={() => {}}
          onReject={() => {}}
          onView={onView}
        />,
      ),
    );
    // The <li> container is the card; click it directly (not a child button).
    // getAllByRole('listitem') returns the two <li> cards.
    const cards = document.querySelectorAll('li[role="button"]');
    expect(cards.length).toBe(2);
    fireEvent.click(cards[0] as HTMLElement);
    expect(onView).toHaveBeenCalledWith('s1');
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('#119 clicking Accept does NOT also fire onView (stopPropagation)', () => {
    const onView = vi.fn();
    const onAccept = vi.fn();
    render(
      wrap(
        <SuggestionsDrawer
          open
          onOpenChange={() => {}}
          suggestions={[{ id: 's1', authorName: 'Ada' }]}
          onAccept={onAccept}
          onReject={() => {}}
          onView={onView}
        />,
      ),
    );
    const acceptBtn = screen.getByRole('button', {
      name: enMessages['pageActions.suggest.accept'],
    });
    fireEvent.click(acceptBtn);
    expect(onAccept).toHaveBeenCalledWith('s1');
    expect(onView).not.toHaveBeenCalled();
  });
```

These tests fail because the `<li>` currently has no `role="button"` and no `onClick`, and `onView` is not called when clicking the card body.

#### Run to fail

```sh
source ~/.zshenv && pnpm vitest run tests/components/editor/suggestions-drawer.test.tsx
```

Expected: the two new tests fail — `cards.length` is 0 (no `role="button"` on `<li>`), and Accept click fires `onView` (no stopPropagation yet).

#### Minimal implementation

Edit `src/components/editor/suggestions-drawer.tsx`. Change the `<li>` element at line 63 and add `stopPropagation` to the three inner buttons.

**Before** (line 63):
```tsx
                  <li key={s.id} className="rounded-md border p-3">
```

**After:**
```tsx
                  <li
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer rounded-md border p-3 hover:bg-accent/50 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => onView(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onView(s.id);
                      }
                    }}
                  >
```

**Before** (View button, ~line 99):
```tsx
                      <button
                        type="button"
                        onClick={() => onView(s.id)}
                        className="rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                      >
```

**After:**
```tsx
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onView(s.id); }}
                        className="rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                      >
```

**Before** (Accept button, ~line 107):
```tsx
                      <button
                        type="button"
                        onClick={() => onAccept(s.id)}
                        className="rounded px-2 py-1 text-green-700 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-green-400"
                      >
```

**After:**
```tsx
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onAccept(s.id); }}
                        className="rounded px-2 py-1 text-green-700 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-green-400"
                      >
```

**Before** (Reject button, ~line 115):
```tsx
                      <button
                        type="button"
                        onClick={() => onReject(s.id)}
                        className="rounded px-2 py-1 text-red-700 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-red-400"
                      >
```

**After:**
```tsx
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onReject(s.id); }}
                        className="rounded px-2 py-1 text-red-700 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-red-400"
                      >
```

**i18n:** No new strings. The card click reuses `onView` which is already backed by the existing `pageActions.suggest.viewInDoc` key in en/es/ar.

#### Run to pass

```sh
source ~/.zshenv && pnpm vitest run tests/components/editor/suggestions-drawer.test.tsx
```

All tests in the file pass (both existing and the two new ones).

#### Commit

```sh
source ~/.zshenv && git add src/components/editor/suggestions-drawer.tsx tests/components/editor/suggestions-drawer.test.tsx && git commit -m "$(cat <<'EOF'
feat(editor): make suggestion card container clickable, fires onView (#119)

The entire <li> card in SuggestionsDrawer now has role="button", tabIndex=0,
onClick → onView, and a keyboard handler (Enter/Space). Accept, Reject, and
View buttons call stopPropagation so card-level click does not double-fire.
No new i18n strings needed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — Gate: lint, typecheck, i18n, full test suite, build, a11y e2e

- [ ] Run Biome — 0 errors:
  ```sh
  source ~/.zshenv && pnpm lint
  ```
- [ ] Run TypeScript — 0 errors:
  ```sh
  source ~/.zshenv && pnpm typecheck
  ```
- [ ] i18n audit — no new strings: both fixes reuse existing keys. `consumeSlashRange` is a pure imperative call (no UI text). The `<li>` card click reuses `onView` which is already i18n-keyed at `pageActions.suggest.viewInDoc` in `messages/en.json`, `messages/es.json`, `messages/ar.json`. Confirm by grepping:
  ```sh
  source ~/.zshenv && grep -r "suggest\." messages/ | grep -v ".json.bak"
  ```
  No new keys expected. If any new key was accidentally introduced, add it to `messages/en.json`, `messages/es.json`, and `messages/ar.json` before proceeding.
- [ ] Full Vitest suite — 0 failures:
  ```sh
  source ~/.zshenv && pnpm vitest run
  ```
- [ ] Next.js build — 0 errors:
  ```sh
  source ~/.zshenv && pnpm build
  ```
- [ ] a11y e2e gate:
  ```sh
  source ~/.zshenv && pnpm test:a11y
  ```
- [ ] All green. Do not push — controller/human pushes.

---

> **Do not push.** The controller/human pushes `patches/v0.9.13` and opens the PR.
