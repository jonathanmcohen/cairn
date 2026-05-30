# P22 — New-Page Default Icon + Editor Chrome (Placeholder / Block Insert / Reader Toggle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix four small-but-visible editor/page-chrome papercuts surfaced by the v0.9.4 UX audit: (#83) new pages get a *random* emoji icon instead of a neutral default; (#84) an empty page never shows the `Type '/' for commands` placeholder; (#96) the block hover handle offers no `+` insert affordance; (#104) the Reader (eye) mode toggle has a weak active state and no accessible-label parity with a tooltip.

**Architecture:** All four are presentation/affordance fixes, not data-model changes.
- #83 is a one-line default in `src/lib/pages/create.ts` plus retiring the random-picker call (the curated palette + `randomDefaultIcon()` stay available for the icon picker; only the *create-time default* changes).
- #84 is purely missing CSS: the `@tiptap/extensions` Placeholder extension already emits a ProseMirror node decoration carrying `class="is-empty"` (+ `is-editor-empty` on the doc's first node) and a `data-placeholder` attribute, but **nothing in the codebase renders that attribute as visible text** — there is no `.is-empty::before` rule in any `.css` file. We add the rule to `src/components/editor/blocks.css` (already imported by `globals.css`).
- #96 extends the existing `DragHandle` floating component (`src/components/editor/drag-handle.tsx`) with a sibling `+` button that inserts an empty paragraph below the hovered block and drops the caret into it (so the user can immediately type `/` to open the slash menu) — an attrs-only / structural ProseMirror transaction, Yjs-safe.
- #104 strengthens `src/components/pages/page-mode-toggles.tsx`: keeps the existing `aria-pressed` toggle buttons + native `title` tooltip, adds i18n strings, and gives the *pressed* state a clearer ring/contrast treatment that meets WCAG AA. **No new Tooltip dependency** — the project has no `ui/tooltip` primitive and the toggles already use the native `title` attribute; this plan does not introduce Radix Tooltip.

**Tech Stack:** React 19, TipTap 3 (`@tiptap/core`, `@tiptap/react`), `@tiptap/extensions` Placeholder, Tailwind v4 (`@theme` in `globals.css`, no config file), `lucide-react`, i18n via `useT()` from `src/lib/i18n/provider` (flat-key catalogs in `messages/{en,es,ar}.json`).

**Covers:** GH #83 (random new-page icon), #84 (missing empty placeholder), #96 (no `+` insert on block handle), #104 (Reader toggle label/tooltip/active-state).

**Yjs-safety note:** #96's transaction only inserts a standard empty `paragraph` node and moves the selection — it writes ProseMirror document structure (synced by y-prosemirror), never node-view-local state. #83/#84/#104 touch no document content at all. No custom node gains non-attr NodeView state.

**Cross-reference:** P14 (`-14-editor-blocks.md`, "Covers" line `#17 …`) also edits `src/components/pages/page-mode-toggles.tsx` for the duplicate-top-right-control-box fix (#17). **Land P14's #17 fix first if both are in flight**, then rebase this plan's #104 change on top — both touch the same file but different concerns (P14 = where the toggles mount; P22 = how the Reader toggle looks/labels). If executed out of order, re-read the file before Task 4's edit and reconcile by hand.

---

### Task 1: Default new pages to a neutral icon (#83)

**Files:**
- Modify: `src/lib/pages/create.ts`
- Test: `tests/lib/pages/create-default-icon.test.ts` (new) — `tests/lib/pages/default-icon.test.ts` keeps passing unchanged (the curated palette + `randomDefaultIcon` stay for the icon picker).

- [ ] **Step 1: Write the failing test**

The create-time default must be a deterministic neutral document emoji, NOT a random pick. Use a unit test that asserts the stored icon shape without a DB (call the formatter the same way `create.ts` does).

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_ICON } from '@/lib/pages/default-icon';
import { formatIcon, parseIcon } from '@/lib/pages/icon-format';

describe('new-page default icon (#83)', () => {
  it('is the neutral document emoji, not a random palette pick', () => {
    expect(DEFAULT_PAGE_ICON).toBe('📄');
  });

  it('round-trips through the icon-format prefix convention', () => {
    const stored = formatIcon({ kind: 'emoji', value: DEFAULT_PAGE_ICON });
    expect(stored).toBe('emoji::📄');
    expect(parseIcon(stored)).toEqual({ kind: 'emoji', value: '📄' });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/pages/create-default-icon.test.ts`
Expected: FAIL — `DEFAULT_PAGE_ICON` is not exported from `@/lib/pages/default-icon`.

- [ ] **Step 3: Add the neutral constant + switch the create default**

In `src/lib/pages/default-icon.ts`, add the neutral default alongside the existing curated palette (keep `DEFAULT_ICONS` + `randomDefaultIcon` — they remain used by the icon picker / random-icon affordance):

```ts
/**
 * v0.9.4 #83 — the neutral default icon assigned at page-create time. Audit
 * feedback: a *random* emoji on every new page reads as noise / accidental.
 * A plain document glyph is calm and signals "untitled page". The curated
 * `DEFAULT_ICONS` palette + `randomDefaultIcon()` below stay for the icon
 * picker's "surprise me" affordance — only the create-time default changed.
 */
export const DEFAULT_PAGE_ICON = '📄';
```

In `src/lib/pages/create.ts`, swap the random default. Replace the import line:

```ts
import { randomDefaultIcon } from './default-icon';
```

with:

```ts
import { DEFAULT_PAGE_ICON } from './default-icon';
```

and replace the `icon:` field in the insert `.values({ … })`:

```ts
        icon: input.icon ?? formatIcon({ kind: 'emoji', value: DEFAULT_PAGE_ICON }),
```

(The `input.icon ?? …` precedence is unchanged — explicit callers, e.g. duplicate/template paths, still win.)

- [ ] **Step 4: Run the new test + the existing palette test, confirm both pass**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/pages/create-default-icon.test.ts tests/lib/pages/default-icon.test.ts`
Expected: PASS — new test green; the palette test still passes because `DEFAULT_ICONS`/`randomDefaultIcon` are untouched.

- [ ] **Step 5: Verify there are no other create-time random-icon call sites**

Run: `source ~/.zshenv && grep -rn "randomDefaultIcon" src/`
Expected: remaining references are the icon-picker / "random" affordance only (NOT a page-create path). If any other create/insert path uses `randomDefaultIcon()` as a *default*, apply the same swap there and note it in the commit. The v1 API create route (`src/app/api/v1/pages/route.ts`) and the app route (`src/app/api/pages/route.ts`) both delegate to `createPage` — confirm they don't assign their own random default.

- [ ] **Step 6: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
```bash
git add src/lib/pages/default-icon.ts src/lib/pages/create.ts tests/lib/pages/create-default-icon.test.ts
git commit -m "fix(pages): neutral default page icon instead of random emoji — Closes #83"
```

---

### Task 2: Render the empty-page placeholder (#84)

**Files:**
- Modify: `src/components/editor/blocks.css`
- Test: `tests/components/editor/placeholder-extension.test.ts` (new) — asserts the Placeholder extension is configured + the CSS rule exists. (We cannot assert painted `::before` content in JSDOM, so the test guards the two failure modes: the extension's callback wiring and the presence of the CSS contract.)

**Diagnosis (root cause):** The `Placeholder` extension from `@tiptap/extensions` is configured in `src/components/editor/extensions.ts` and returns `Heading` / `Type '/' for commands`. At runtime it installs a ProseMirror plugin whose `decorations` add a **node decoration** with `class: "is-empty"` (and `"is-editor-empty"` on the doc's first child) plus a `data-placeholder="…"` attribute on the empty node's DOM element. **The visible text is produced entirely by CSS** — the extension never injects text; it relies on a `::before { content: attr(data-placeholder) }` rule. Grepping the repo (`grep -rn "is-empty\|is-editor-empty\|data-placeholder\|::before" src/**/*.css`) shows that rule is **absent** — `blocks.css` styles `.ProseMirror` extensively but has no placeholder rule, and `globals.css`'s only `::before` is the border-color reset. So the decoration class lands on the empty `<p>`, but with nothing to paint, the placeholder is invisible. The `showOnlyCurrent: true` default (only show on the focused node) is fine for our goal — a freshly created page focuses the single empty paragraph, so the rule will paint there. The fix is to add the missing CSS contract.

- [ ] **Step 1: Write the failing/guard test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';

describe('empty-page placeholder (#84)', () => {
  it('configures the Placeholder extension with the slash hint', () => {
    const ext = baseExtensions();
    const placeholder = ext.find((e) => e.name === 'placeholder');
    expect(placeholder).toBeTruthy();
    // The callback resolves to the slash hint for a paragraph and 'Heading' for headings.
    const cb = placeholder?.options?.placeholder as
      | ((p: { node: { type: { name: string } } }) => string)
      | undefined;
    expect(typeof cb).toBe('function');
    expect(cb?.({ node: { type: { name: 'paragraph' } } })).toBe("Type '/' for commands");
    expect(cb?.({ node: { type: { name: 'heading' } } })).toBe('Heading');
  });

  it('ships the CSS contract that paints data-placeholder via ::before', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/editor/blocks.css'),
      'utf8',
    );
    // The extension only adds the class + attribute; the visible text is CSS.
    expect(css).toMatch(/\.is-empty(::|:)?.*::before/s);
    expect(css).toContain('content: attr(data-placeholder)');
  });
});
```

- [ ] **Step 2: Run it, confirm the CSS assertion fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/placeholder-extension.test.ts`
Expected: the extension-config assertion passes; the **CSS-contract assertion FAILS** (no `::before` placeholder rule exists yet). This proves the diagnosis.

- [ ] **Step 3: Add the placeholder CSS to `blocks.css`**

Append to `src/components/editor/blocks.css`:

```css
/*
 * v0.9.4 #84 — empty-paragraph placeholder ("Type '/' for commands").
 *
 * The @tiptap/extensions Placeholder extension adds a node decoration carrying
 * `class="is-empty"` (+ `is-editor-empty` on the doc's first node) and a
 * `data-placeholder` attribute to the empty block's DOM node. It injects NO
 * text — the visible hint is produced entirely by this CSS. Without it the
 * placeholder silently never renders (the bug). `showOnlyCurrent: true`
 * (the extension default) means only the focused empty node paints, which is
 * exactly what we want for a fresh page.
 */
.ProseMirror .is-empty::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: hsl(var(--muted-foreground));
}

/* RTL: the placeholder hangs on the right when the doc direction is rtl. */
.ProseMirror[dir="rtl"] .is-empty::before {
  float: right;
}
```

(`--muted-foreground` is an existing theme token used throughout the editor chrome; `float:left; height:0` is the canonical TipTap placeholder technique that keeps the caret at the line start and lets the user type over the hint.)

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/placeholder-extension.test.ts`
Expected: PASS — both the extension-config and CSS-contract assertions are green.

- [ ] **Step 5: Manual verification note (human/smoke)**

Run `source ~/.zshenv && pnpm dev`, create a new page, and confirm the empty first paragraph shows `Type '/' for commands` (and an empty H1/H2 shows `Heading`). Confirm the hint disappears as soon as a character is typed and does not leave a layout shift. This is a CSS-only behavior JSDOM cannot paint, so the smoke check is the real gate.

- [ ] **Step 6: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
```bash
git add src/components/editor/blocks.css tests/components/editor/placeholder-extension.test.ts
git commit -m "fix(editor): render empty-paragraph placeholder via missing ::before rule — Closes #84"
```

---

### Task 3: Add a `+` insert button to the block hover handle (#96)

**Files:**
- Modify: `src/components/editor/drag-handle.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Test: `tests/components/editor/drag-handle-insert.test.tsx` (new, JSDOM)

**Design:** Render a small `+` button immediately to the left of the existing `GripVertical` handle (both inside the absolutely-positioned wrapper). Clicking `+` inserts an empty paragraph **below** the hovered block and moves the caret into it, then focuses the editor — so the user can immediately type `/` to open the slash menu (matching Notion's "click + to add a block, type / for the menu" affordance). This reuses the same `targetPos` the component already tracks. The handle currently uses `GripVertical` from `lucide-react`; add `Plus`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DragHandle } from '@/components/editor/drag-handle';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

// Minimal editor mock: enough surface for DragHandle's effect + action().
function makeEditorMock() {
  const insert = vi.fn();
  const focus = () => chain;
  const run = vi.fn();
  const chain: Record<string, unknown> = {};
  chain.focus = () => chain;
  chain.command = (fn: (a: { tr: { insert: typeof insert } }) => boolean) => {
    fn({ tr: { insert } as never });
    return chain;
  };
  chain.run = run;
  return {
    chain: () => chain,
    state: { doc: { resolve: () => ({ after: () => 4, before: () => 0 }), nodeAt: () => ({}) } },
    view: {
      dom: document.createElement('div'),
      posAtDOM: () => 1,
    },
    insert,
    run,
  } as unknown as Editor & { insert: typeof insert; run: typeof run };
}

describe('DragHandle + insert button (#96)', () => {
  it('renders an accessible "+" insert button alongside the drag handle', () => {
    const editor = makeEditorMock();
    render(
      <I18nProvider locale="en" messages={enMessages as never}>
        <DragHandle editor={editor} />
      </I18nProvider>,
    );
    // The handle only renders once a block is hovered; simulate a mousemove
    // over the editor DOM so `pos` becomes non-null.
    fireEvent.mouseMove(editor.view.dom, { target: editor.view.dom });
    // After hover, both buttons exist:
    expect(screen.queryByRole('button', { name: /insert block below/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /block actions/i })).toBeTruthy();
  });
});
```

> NOTE to implementer: the `editor.view.dom` mousemove path in `DragHandle` calls `closest(...)` on `e.target`; a bare div may not match the block selector. If the hover branch is awkward to trigger under JSDOM, simplify the test to assert that `DragHandle`'s rendered button set includes the `+` label by hovering a child node you append to `editor.view.dom` that matches one of the selector tags (e.g. append a `<p>`), OR refactor the visibility so the test can drive `pos`. Keep the test asserting the **accessible name** of the `+` button comes from the i18n catalog (`editor.insertBelow`), not a hard-coded string.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/drag-handle-insert.test.tsx`
Expected: FAIL — no `Insert block below` button exists.

- [ ] **Step 3: Add the i18n strings**

Add to `messages/en.json`:

```json
  "editor.blockActions": "Block actions",
  "editor.insertBelow": "Insert block below"
```

Add the same keys to `messages/es.json` (e.g. `"editor.blockActions": "Acciones de bloque"`, `"editor.insertBelow": "Insertar bloque debajo"`) and `messages/ar.json` (e.g. `"editor.blockActions": "إجراءات الكتلة"`, `"editor.insertBelow": "إدراج كتلة بالأسفل"`). Match the existing flat-key, alphabetical-ish placement convention in each file; if unsure of the Arabic wording, mirror the structure and leave a translator-friendly value — the i18n Biome rule only enforces key parity across catalogs.

- [ ] **Step 4: Implement the `+` button + insert action**

In `src/components/editor/drag-handle.tsx`:

1. Add `Plus` to the lucide import and `useT`:

```ts
import { GripVertical, Plus } from 'lucide-react';
```
```ts
import { useT } from '@/lib/i18n/provider';
```

2. Inside the component, get `t`:

```ts
  const t = useT();
```

3. Add an `insertBelow` handler next to `action(...)`. It inserts an empty paragraph at the end of the hovered top-level block and drops the caret inside it:

```ts
  function insertBelow() {
    if (targetPos === null) return;
    const { doc, schema } = editor.state;
    const $pos = doc.resolve(targetPos);
    const blockEnd = $pos.after(1);
    const paragraph = schema.nodes.paragraph.createAndFill();
    if (!paragraph) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insert(blockEnd, paragraph);
        return true;
      })
      // place the caret inside the new empty paragraph (blockEnd + 1)
      .setTextSelection(blockEnd + 1)
      .focus()
      .run();
    setOpen(false);
  }
```

> Implementer: verify the `setTextSelection` target against the live TipTap chain API in this version; if `setTextSelection` is unavailable on the chain, set the selection inside the `command` via `tr.setSelection(TextSelection.create(tr.doc, blockEnd + 1))` (import `TextSelection` from `@tiptap/pm/state`). The intent: caret lands in the new empty paragraph so the user can type `/` immediately — the placeholder from Task 2 will show `Type '/' for commands` there.

4. Update the rendered wrapper so the `+` sits left of the grip, both vertically centered. Replace the existing single-button render block with a two-button cluster, and use the i18n label on the existing grip button too:

```tsx
  return (
    <div
      ref={wrapperRef}
      style={{ position: 'absolute', top: pos.top, left: pos.left }}
      className="flex items-start gap-0.5"
    >
      <button
        type="button"
        aria-label={t('editor.insertBelow')}
        title={t('editor.insertBelow')}
        onClick={insertBelow}
        className="text-muted-foreground hover:bg-accent flex h-6 w-6 items-center justify-center rounded"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={t('editor.blockActions')}
        title={t('editor.blockActions')}
        {...getReferenceProps()}
        className="text-muted-foreground hover:bg-accent flex h-6 w-6 items-center justify-center rounded"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {open && (
        /* …existing floating menu unchanged… */
      )}
    </div>
  );
```

> The handle's `left: -28` offset (in the `pos` state) now hosts two 24px buttons. Widen the gutter so the `+` doesn't overlap the prose: change the `left` value set in the `onMove` handler from `-28` to `-52` (two 24px buttons + 4px gap). Verify visually that the cluster sits in the left margin and doesn't overlap text at the editor's `max-w-none` width.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/drag-handle-insert.test.tsx`
Expected: PASS.

- [ ] **Step 6: Manual verification note (human/smoke)**

In `pnpm dev`: hover a block, confirm a `+` appears left of the drag grip; click it; confirm a new empty paragraph appears below with the caret in it and the `Type '/' for commands` placeholder visible; type `/` and confirm the slash menu opens. Confirm both buttons are >=24px and reachable; the touch-target note below.

- [ ] **Step 7: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
```bash
git add src/components/editor/drag-handle.tsx messages/en.json messages/es.json messages/ar.json tests/components/editor/drag-handle-insert.test.tsx
git commit -m "feat(editor): add + insert button to block hover handle — Closes #96"
```

> **Touch-target note (#96):** the block-handle buttons are 24px (`h-6 w-6`), consistent with the *existing* drag grip, which is a fine-pointer hover-only affordance (it only appears on mouse hover over a block, never on touch). The WCAG 2.5.5 / 44px gate applies to the page-mode toggles in Task 4 (persistent header controls). Do NOT inflate the hover handle to 44px — it would overwhelm the prose gutter. If the reviewer wants AA target-size on the handle, the correct fix is a larger invisible hit-area (`::before` pseudo) rather than a larger visible glyph; out of scope for this audit item.

---

### Task 4: Reader-mode toggle — label, tooltip, and stronger active state (#104)

**Files:**
- Modify: `src/components/pages/page-mode-toggles.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Test: `tests/a11y/page-mode-toggles.test.tsx` (extend the existing test)

**Cross-ref:** see the plan header — P14 (`-14-editor-blocks.md`) edits this same file for #17 (single top-right control group). If P14 has landed, re-read the file before editing; the two changes are independent (P14 = mount site, P22 = button labels/active-state) and should compose cleanly.

**Design:** The component currently uses `aria-label` + native `title` (which IS a browser tooltip) and `variant={reader ? 'default' : 'outline'}`. Audit feedback: the active state is too subtle and the labels/tooltips should be i18n'd and explicit. We (a) move the hard-coded strings to the i18n catalog, (b) keep `aria-pressed` (already correct), and (c) make the pressed state unmistakable with an added ring + retained `default` variant. No new Tooltip primitive — native `title` is the tooltip, `aria-label` is the accessible name (both already present; we keep both and i18n them).

- [ ] **Step 1: Extend the failing test**

Add to `tests/a11y/page-mode-toggles.test.tsx` a third assertion block. The component reads i18n via `useT()`, so wrap it in `I18nProvider` (the existing two tests render bare — keep those, but the new test must provide the provider since the component now calls `useT`). Update the existing two tests to also wrap in `I18nProvider` (otherwise they throw "useT must be used inside <I18nProvider>").

```tsx
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json';

function renderToggles() {
  return render(
    <I18nProvider locale="en" messages={enMessages as never}>
      <PageModeShell>
        <PageModeToggles />
      </PageModeShell>
    </I18nProvider>,
  );
}
```

Then refactor the existing `render(<PageModeShell>…)` calls to `renderToggles()`, and add:

```tsx
  it('reader toggle exposes an i18n label + a native title tooltip', () => {
    renderToggles();
    const reader = screen.getByRole('button', { name: /reader/i });
    // accessible name (aria-label) and tooltip (title) both present and equal-ish
    expect(reader.getAttribute('aria-label')).toBeTruthy();
    expect(reader.getAttribute('title')).toBeTruthy();
    // aria-pressed reflects state and starts off
    expect(reader.getAttribute('aria-pressed')).toBe('false');
  });

  it('reader toggle carries an explicit pressed-state ring utility', () => {
    renderToggles();
    const reader = screen.getByRole('button', { name: /reader/i });
    // the active treatment is wired via aria-pressed-driven classes
    expect(reader.getAttribute('class')).toMatch(/aria-pressed:ring|data-\[state/);
  });
```

> Implementer: align the second assertion's regex with whichever active-state mechanism you choose in Step 3 (Tailwind `aria-pressed:` variant vs. a className ternary). If you use a JS ternary on `reader` instead of an `aria-pressed:` variant, assert the ring class is present when pressed by rendering with a forced-pressed context, or drop to asserting the ring utility string is in the className list. Keep the test meaningful (it must fail before the change).

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/a11y/page-mode-toggles.test.tsx`
Expected: FAIL — without `I18nProvider` the component throws (after we add `useT` in Step 3), and/or the ring-class assertion fails. (If run before Step 3, the i18n-label assertions may pass against the hard-coded strings; the ring assertion is the guaranteed-failing one.)

- [ ] **Step 3: Add i18n strings**

Add to `messages/en.json`:

```json
  "pageMode.focus": "Focus mode",
  "pageMode.focusHint": "Focus mode (hide sidebar, header, and comments)",
  "pageMode.reader": "Reader mode",
  "pageMode.readerHint": "Reader mode (read-only prose view)"
```

Add parity keys to `messages/es.json` and `messages/ar.json` (mirror structure; e.g. es `"pageMode.reader": "Modo lectura"`, `"pageMode.focus": "Modo concentración"`).

- [ ] **Step 4: Update the component**

Rewrite `src/components/pages/page-mode-toggles.tsx` to use `useT` and a stronger active state. Keep both buttons, `aria-pressed`, and the 44px touch targets:

```tsx
'use client';

import { Eye, Maximize2 } from 'lucide-react';
import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { usePageMode } from './page-mode-shell';

/**
 * Page-header toggle pair surfaced inside `<PageModeShell>`'s `toggles` slot.
 *
 * v0.9.0 G6 P33: two stand-alone toggles, not a single 3-state segmented
 * control — focus and reader are independently composable.
 *
 * v0.9.4 #104: i18n'd labels + native-title tooltips, and a stronger pressed
 * state — the active toggle keeps the solid `default` variant AND gains a
 * focus-ring-colored 2px ring so the on/off distinction is obvious at a glance
 * (the prior `default` vs `outline` swap alone read as too subtle).
 *
 * a11y: both are `aria-pressed` toggle buttons with an explicit `aria-label`
 * (the accessible name) plus a `title` (the hover tooltip), and pad to 44x44
 * min to satisfy the WCAG 2.5.5 touch-target gate.
 */
export function PageModeToggles() {
  const { focus, reader, setFocus, setReader } = usePageMode();
  const t = useT();
  const pressedRing =
    'ring-2 ring-ring ring-offset-1 ring-offset-background';
  return (
    <>
      <Button
        type="button"
        variant={focus ? 'default' : 'outline'}
        size="icon"
        aria-pressed={focus}
        aria-label={t('pageMode.focus')}
        title={t('pageMode.focusHint')}
        className={`min-h-[44px] min-w-[44px] ${focus ? pressedRing : ''}`}
        onClick={() => setFocus(!focus)}
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={reader ? 'default' : 'outline'}
        size="icon"
        aria-pressed={reader}
        aria-label={t('pageMode.reader')}
        title={t('pageMode.readerHint')}
        className={`min-h-[44px] min-w-[44px] ${reader ? pressedRing : ''}`}
        onClick={() => setReader(!reader)}
      >
        <Eye className="h-4 w-4" />
      </Button>
    </>
  );
}
```

> The pressed ring uses `ring-ring` (the theme focus-ring token, already used by `:focus-visible` in globals.css) at 2px with a 1px offset — high contrast in both light and dark, meeting WCAG 1.4.11 non-text contrast for the state indicator. The solid `default` variant background is retained so the indicator is not ring-only (ring + fill = redundant cues). If `cn()` is preferred over template strings for class merging, use `cn('min-h-[44px] min-w-[44px]', reader && pressedRing)` and import `cn` from `@/lib/utils`.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/a11y/page-mode-toggles.test.tsx`
Expected: PASS — all four assertions (existing two + new two) green.

- [ ] **Step 6: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
```bash
git add src/components/pages/page-mode-toggles.tsx messages/en.json messages/es.json messages/ar.json tests/a11y/page-mode-toggles.test.tsx
git commit -m "fix(editor): accessible label + tooltip + stronger active state on reader/focus toggles — Closes #104"
```

---

## Self-Review

- **Spec coverage:** #83 (neutral default icon), #84 (placeholder CSS), #96 (`+` insert button), #104 (reader toggle a11y + active state) — each its own task + commit. ✓
- **#84 diagnosis is explicit and proven by a test:** the Placeholder extension only emits a class + `data-placeholder` attribute via a node decoration; the missing `.is-empty::before { content: attr(data-placeholder) }` rule is the root cause; the guard test fails before the CSS is added. ✓
- **Yjs-safety:** #96 inserts a standard `paragraph` node + moves selection (document structure, synced by y-prosemirror); no node-view-local state introduced. #83/#84/#104 touch no document content. ✓
- **i18n:** every new user-facing string added to `en`/`es`/`ar` catalogs with key parity (the project's Biome i18n rule enforces parity). ✓
- **WCAG AA + 44px:** Task 4 keeps the 44px touch targets and adds a redundant (fill + ring) state cue meeting 1.4.11. The #96 hover handle is intentionally NOT inflated to 44px (fine-pointer hover-only affordance) — rationale documented in Task 3's touch-target note. ✓
- **Cross-ref to P14:** flagged in the header and Task 4 — both edit `page-mode-toggles.tsx` for different concerns; land #17 first if concurrent. ✓
- **Placeholders left for the implementer:** the `+` insert selection API (`setTextSelection` vs `TextSelection.create`) and the exact active-state assertion regex are called out as "verify against the live API / align with your choice" — the implementer must read the file first. ✓
