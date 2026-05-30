# P29 — Editor Inline Formatting Bubble Menu + Link Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the TipTap editor a selection-driven inline formatting bubble menu (#116) and a non-conflicting insert-link keyboard shortcut (#117). When the user selects text, a floating toolbar surfaces Bold / Italic / Strikethrough / Code, a Link control (themed popover input), and clear-formatting — reusing the marks already registered by StarterKit. A new editor-scoped `⌘⇧K` inserts a link, and when a non-empty text selection is active inside the editor `⌘K` is intercepted to mean "link" (instead of opening the search palette).

**Architecture:**
- **Bubble menu** uses `BubbleMenu` imported from **`@tiptap/react/menus`** (TipTap 3 moved the bubble/floating menus to that subpath to keep `floating-ui` optional). The package is **already installed transitively** — `@tiptap/react@3.23.6` pulls in `@tiptap/extension-bubble-menu@3.23.6` and `@floating-ui/*`; both exist under `node_modules/.pnpm/`. **No new dependency is needed.** We do NOT add `@tiptap/extension-bubble-menu` to `package.json` directly; the React wrapper is the supported surface.
- **Marks reused, none added.** StarterKit 3 bundles `Bold`, `Italic`, `Strike`, `Code`, and `Link`. `extensions.ts` only disables `codeBlock` and configures `heading` — Link and the inline marks are live. So `editor.chain().focus().toggleBold()/toggleItalic()/toggleStrike()/toggleCode()/setLink()/unsetLink()/unsetAllMarks()` are all available with no extension change. We DO add one config tweak: `StarterKit.configure({ link: { openOnClick: false, autolink: true } })` so clicking a link in the editable surface places the caret rather than navigating, and pasted URLs auto-link.
- **Bubble menu is Yjs-safe by construction:** it issues the SAME mark commands the keyboard already issues (`toggleBold` etc.), which flow through ProseMirror transactions → the `Collaboration` extension → Yjs. It stores zero node-local state and adds no schema. It must NOT show while the slash menu / mention / page-link suggestion popups are open, and must NOT show over the suggestion (track-changes) marks' own affordances — the `shouldShow` predicate gates on this (see Task 2).
- **Link input** is a small React popover (`EditorLinkPopover`) rendered inside the bubble menu, styled with the existing `bg-popover text-popover-foreground border shadow-md` token set (same recipe as `page-link-popover.tsx`). It is NOT a separate floating layer — it renders inline in the bubble menu container so focus stays trapped and the menu's `shouldShow` keeps it visible while typing.
- **Shortcut conflict (#117) resolution — DECIDED:**
  - Add a new **editor-scoped** shortcut `link.insert` = `Mod+Shift+K` in the registry (`scope: 'editor'`, the first entry in the currently-empty editor group). It is surfaced in the shortcuts sheet and the bubble menu (title attr) and wired as a TipTap `addKeyboardShortcuts` entry on a tiny `EditorLinkShortcut` extension so it works regardless of global-listener ordering.
  - Additionally intercept `⌘K`/`Ctrl+K`: the global palette handler in `src/components/search-palette.tsx` currently fires on ANY `(meta|ctrl)+k` window keydown with no focus/selection check — that is the conflict. We change it to **bail when an editor surface has a non-empty text selection**, so inside the editor a ranged `⌘K` opens the link control instead of the palette. With a collapsed caret (or focus outside the editor) `⌘K` still opens the palette unchanged. The link extension's `addKeyboardShortcuts` claims `Mod-k` only when `!editor.state.selection.empty`, returning `false` (lets the event bubble to the palette) when the selection is collapsed. This keeps both behaviors and documents the tie-break in code comments.

**Tech Stack:** TipTap 3.23.6 (`@tiptap/react` + `@tiptap/react/menus`), React 19, Tailwind v4, `cn()` from `src/lib/utils.ts`, i18n via `useT()` (`src/lib/i18n/provider`), shortcut registry `src/lib/shortcuts/registry.ts`.

**Covers:** GH #116 (no inline formatting bubble menu), #117 (⌘K palette vs insert-link conflict).

---

### Task 1: Add the editor-formatting i18n strings (en / es / ar)

**Files:**
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Test: `tests/i18n/parity.test.ts` (exists — keep passing; it asserts key-set parity across locales)

- [ ] **Step 1: Read the parity test first**

Run: `source ~/.zshenv && cat tests/i18n/parity.test.ts` (or grep `tests/i18n/`). Confirm it compares the key sets of all three locale files. The new keys MUST be added to all three or this test fails.

- [ ] **Step 2: Add the keys to `messages/en.json`**

Insert after the existing `shortcut.openSheet` line (keep valid JSON — add commas):

```json
  "shortcut.insertLink": "Insert link",
  "editor.bubble.bold": "Bold",
  "editor.bubble.italic": "Italic",
  "editor.bubble.strike": "Strikethrough",
  "editor.bubble.code": "Inline code",
  "editor.bubble.link": "Link",
  "editor.bubble.clear": "Clear formatting",
  "editor.link.placeholder": "Paste or type a URL",
  "editor.link.apply": "Apply link",
  "editor.link.remove": "Remove link",
  "editor.link.cancel": "Cancel"
```

- [ ] **Step 3: Add the same keys to `messages/es.json`**

```json
  "shortcut.insertLink": "Insertar enlace",
  "editor.bubble.bold": "Negrita",
  "editor.bubble.italic": "Cursiva",
  "editor.bubble.strike": "Tachado",
  "editor.bubble.code": "Código en línea",
  "editor.bubble.link": "Enlace",
  "editor.bubble.clear": "Borrar formato",
  "editor.link.placeholder": "Pega o escribe una URL",
  "editor.link.apply": "Aplicar enlace",
  "editor.link.remove": "Quitar enlace",
  "editor.link.cancel": "Cancelar"
```

- [ ] **Step 4: Add the same keys to `messages/ar.json`** (RTL — values in Arabic; the keys are identical)

```json
  "shortcut.insertLink": "إدراج رابط",
  "editor.bubble.bold": "غامق",
  "editor.bubble.italic": "مائل",
  "editor.bubble.strike": "يتوسطه خط",
  "editor.bubble.code": "كود مضمّن",
  "editor.bubble.link": "رابط",
  "editor.bubble.clear": "مسح التنسيق",
  "editor.link.placeholder": "الصق أو اكتب عنوان URL",
  "editor.link.apply": "تطبيق الرابط",
  "editor.link.remove": "إزالة الرابط",
  "editor.link.cancel": "إلغاء"
```

- [ ] **Step 5: Verify parity**

Run: `source ~/.zshenv && pnpm vitest run tests/i18n && pnpm lint`
Expected: PASS. Biome may reformat the JSON — accept it.

- [ ] **Step 6: Commit**

```bash
git add messages/en.json messages/es.json messages/ar.json
git commit -m "i18n: editor bubble-menu + insert-link strings (en/es/ar) — refs #116 #117"
```

---

### Task 2: Build the `EditorLinkPopover` + `EditorBubbleMenu` components

**Files:**
- Create: `src/components/editor/editor-link-popover.tsx`
- Create: `src/components/editor/editor-bubble-menu.tsx`
- Test: `tests/components/editor/editor-bubble-menu.test.tsx`

- [ ] **Step 1: Write the failing test**

The test renders the bubble menu against a minimal editor and asserts the toolbar buttons exist with accessible names and ≥44px min sizing classes, and that the link popover toggles. Keep it light — full TipTap mounting in jsdom is flaky, so mock the editor with the small command surface the component calls.

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorBubbleMenu } from '@/components/editor/editor-bubble-menu';

afterEach(cleanup);

// Mock @tiptap/react/menus BubbleMenu to just render its children (we test the
// toolbar contents + handlers, not floating-ui positioning).
vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => <div data-testid="bubble">{children}</div>,
}));
// Mock the i18n provider so labels resolve to keys.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

function makeEditor() {
  const chain = {
    focus: () => chain,
    toggleBold: () => chain,
    toggleItalic: () => chain,
    toggleStrike: () => chain,
    toggleCode: () => chain,
    unsetAllMarks: () => chain,
    setLink: () => chain,
    unsetLink: () => chain,
    extendMarkRange: () => chain,
    run: () => true,
  };
  return {
    chain: () => chain,
    isActive: () => false,
    getAttributes: () => ({}),
    state: { selection: { empty: false } },
  } as never;
}

describe('<EditorBubbleMenu>', () => {
  it('renders the formatting toolbar with accessible, ≥44px buttons', () => {
    render(<EditorBubbleMenu editor={makeEditor()} />);
    const bold = screen.getByRole('button', { name: 'editor.bubble.bold' });
    expect(bold).toBeTruthy();
    expect(bold.className).toContain('min-h-11');
    expect(bold.className).toContain('min-w-11');
    expect(screen.getByRole('button', { name: 'editor.bubble.italic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.bubble.strike' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.bubble.code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.bubble.clear' })).toBeTruthy();
  });

  it('reveals the link input when the link button is pressed', () => {
    render(<EditorBubbleMenu editor={makeEditor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.link' }));
    expect(screen.getByPlaceholderText('editor.link.placeholder')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/editor-bubble-menu.test.tsx`
Expected: FAIL — module `@/components/editor/editor-bubble-menu` not found.

- [ ] **Step 3: Implement `EditorLinkPopover`**

The popover is a controlled input + Apply / Remove / Cancel. It normalizes the href (prepend `https://` when no scheme) and validates with the same permissive rule the rest of the app uses (non-empty, no `javascript:`).

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Block dangerous schemes; allow http/https/mailto and bare domains.
  if (/^\s*javascript:/i.test(trimmed)) return null;
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed.startsWith('/') ? trimmed : `https://${trimmed}`;
}

export function EditorLinkPopover({
  initialHref,
  onApply,
  onRemove,
  onCancel,
}: {
  initialHref: string;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initialHref);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = () => {
    const href = normalizeHref(value);
    if (href) onApply(href);
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1 bg-popover p-1 text-popover-foreground">
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        aria-label={t('editor.bubble.link')}
        placeholder={t('editor.link.placeholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-11 w-56 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      />
      <button
        type="button"
        aria-label={t('editor.link.apply')}
        title={t('editor.link.apply')}
        onClick={apply}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        ↵
      </button>
      {initialHref ? (
        <button
          type="button"
          aria-label={t('editor.link.remove')}
          title={t('editor.link.remove')}
          onClick={onRemove}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm text-destructive hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

// `cn` re-exported intentionally unused guard removed; keep import only if used.
void cn;
```

> Implementer note: drop the trailing `void cn;` / the `cn` import if Biome flags it unused — it's only there as a hint that this file may use `cn` for conditional classes. Prefer removing the import outright.

- [ ] **Step 4: Implement `EditorBubbleMenu`**

```tsx
'use client';

import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import { Bold, Code, Italic, Link2, RemoveFormatting, Strikethrough } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { EditorLinkPopover } from './editor-link-popover';

const BTN =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const t = useT();
  const [linkOpen, setLinkOpen] = useState(false);

  // Yjs-safe: every handler issues a standard mark command through a
  // ProseMirror transaction; the Collaboration extension syncs it to Yjs.
  const toggle = (fn: 'toggleBold' | 'toggleItalic' | 'toggleStrike' | 'toggleCode') =>
    editor.chain().focus()[fn]().run();

  const applyLink = (href: string) => {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  };
  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      // #116/#117 review: hide while suggestion popups (slash/mention/page-link)
      // are open, while a node selection is active (images/blocks), and when the
      // selection is empty. Keeps the menu strictly an inline-text affordance and
      // never steals focus from the slash / suggestion marks UI.
      shouldShow={({ editor: ed, state }) => {
        const { selection } = state;
        if (selection.empty) return false;
        // NodeSelection (atom/leaf blocks) — not a text run; skip.
        if (!('$anchor' in selection) || selection.from === selection.to) return false;
        // Suppress when any suggestion plugin has an active popup. The slash /
        // mention / page-link extensions render via tippy into document.body;
        // detect an open one by querying for their mounted popup container.
        if (document.querySelector('[data-tippy-root]')) return false;
        // Suppress inside code blocks (no inline formatting there).
        if (ed.isActive('codeBlock')) return false;
        return true;
      }}
      options={{ placement: 'top', offset: 8 }}
      className="z-50 flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {linkOpen ? (
        <EditorLinkPopover
          initialHref={(editor.getAttributes('link').href as string) ?? ''}
          onApply={applyLink}
          onRemove={removeLink}
          onCancel={() => setLinkOpen(false)}
        />
      ) : (
        <>
          <button
            type="button"
            aria-label={t('editor.bubble.bold')}
            title={t('editor.bubble.bold')}
            data-active={editor.isActive('bold')}
            onClick={() => toggle('toggleBold')}
            className={cn(BTN)}
          >
            <Bold className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.italic')}
            title={t('editor.bubble.italic')}
            data-active={editor.isActive('italic')}
            onClick={() => toggle('toggleItalic')}
            className={cn(BTN)}
          >
            <Italic className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.strike')}
            title={t('editor.bubble.strike')}
            data-active={editor.isActive('strike')}
            onClick={() => toggle('toggleStrike')}
            className={cn(BTN)}
          >
            <Strikethrough className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.code')}
            title={t('editor.bubble.code')}
            data-active={editor.isActive('code')}
            onClick={() => toggle('toggleCode')}
            className={cn(BTN)}
          >
            <Code className="size-4" aria-hidden />
          </button>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <button
            type="button"
            aria-label={t('editor.bubble.link')}
            title={`${t('editor.bubble.link')} (⌘⇧K)`}
            data-active={editor.isActive('link')}
            onClick={() => setLinkOpen(true)}
            className={cn(BTN)}
          >
            <Link2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('editor.bubble.clear')}
            title={t('editor.bubble.clear')}
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
            className={cn(BTN)}
          >
            <RemoveFormatting className="size-4" aria-hidden />
          </button>
        </>
      )}
    </BubbleMenu>
  );
}
```

> Implementer notes:
> - `aria-label`/`title` on each button satisfy WCAG AA name-from-content (the icon is `aria-hidden`). `min-h-11 min-w-11` = 44px touch targets.
> - The contrast of `accent`/`popover` token pairs is already AA-verified by the existing theme (used by the slash menu + page-link popover) — no new color decisions.
> - If `shouldShow`'s `[data-tippy-root]` heuristic proves too broad in manual QA (e.g. an unrelated tippy tooltip suppresses the menu), narrow it to the slash/mention popups' specific classes; document whatever you pick in a comment.
> - The `BubbleMenu` `options` shape is the TipTap-3 floating-ui form (`placement`, `offset`). If types complain, check `node_modules/@tiptap/extension-bubble-menu/dist/index.d.ts` for the exact `BubbleMenuPluginProps['options']` and match it.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/editor-bubble-menu.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/editor-link-popover.tsx src/components/editor/editor-bubble-menu.tsx tests/components/editor/editor-bubble-menu.test.tsx
git commit -m "feat(editor): inline formatting bubble menu + themed link popover — refs #116"
```

---

### Task 3: Add the `EditorLinkShortcut` extension (⌘⇧K + ⌘K interception)

**Files:**
- Create: `src/components/editor/editor-link-shortcut.ts`
- Test: `tests/components/editor/editor-link-shortcut.test.ts`

The extension owns the keyboard contract so it works no matter the order of window listeners. It exposes a `cairn:editor:open-link` mechanism: pressing the shortcut dispatches a CustomEvent that the editor surface (Task 4) listens for to open the bubble-menu link input. (Using an event keeps the extension free of React state.)

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EditorLinkShortcut } from '@/components/editor/editor-link-shortcut';

describe('EditorLinkShortcut', () => {
  it('registers Mod-Shift-k and a selection-gated Mod-k', () => {
    const ext = EditorLinkShortcut;
    expect(ext.name).toBe('cairnLinkShortcut');
    const shortcuts = ext.config.addKeyboardShortcuts?.call({
      editor: { state: { selection: { empty: true } } },
    } as never);
    expect(shortcuts).toHaveProperty('Mod-Shift-k');
    expect(shortcuts).toHaveProperty('Mod-k');
  });

  it('Mod-k returns false (lets palette through) when selection is empty', () => {
    const dispatch = vi.fn();
    const handlers = EditorLinkShortcut.config.addKeyboardShortcuts?.call({
      editor: { state: { selection: { empty: true } } },
    } as never);
    // @ts-expect-error test-only narrow
    expect(handlers['Mod-k']()).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/editor-link-shortcut.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { Extension } from '@tiptap/core';

/**
 * #117 — Editor link shortcut.
 *  - `Mod-Shift-k` always opens the link input (the dedicated, palette-safe key).
 *  - `Mod-k` opens the link input ONLY when there is a non-empty text selection;
 *    with a collapsed caret it returns `false` so the event bubbles to the global
 *    ⌘K search-palette handler (search-palette.tsx). This is the documented
 *    tie-break: ranged ⌘K inside the editor = link; everything else = palette.
 *
 * The extension is presentation-free: it dispatches a `cairn:editor:open-link`
 * CustomEvent that the editor surface listens for to open the bubble-menu link
 * popover. Keeping it event-based avoids holding React state in a ProseMirror
 * extension and stays Yjs-safe (no schema, no node-local state).
 */
function openLink(): boolean {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cairn:editor:open-link'));
  }
  return true;
}

export const EditorLinkShortcut = Extension.create({
  name: 'cairnLinkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-k': () => openLink(),
      'Mod-k': () => {
        if (this.editor.state.selection.empty) return false; // let palette handle ⌘K
        return openLink();
      },
    };
  },
});
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/editor-link-shortcut.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS. (If `ext.config.addKeyboardShortcuts` isn't reachable that way in TipTap 3, adapt the test to instantiate via `ext.configure()` / read `ext.options` — the implementer should match whatever the installed `@tiptap/core` exposes; the behavioral contract, not the introspection path, is what matters.)

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/editor-link-shortcut.ts tests/components/editor/editor-link-shortcut.test.ts
git commit -m "feat(editor): Mod+Shift+K insert-link + selection-gated Mod+K — refs #117"
```

---

### Task 4: Wire the bubble menu + shortcut into the editor; configure Link

**Files:**
- Modify: `src/components/editor/extensions.ts` (configure StarterKit `link`; register `EditorLinkShortcut` in both `baseExtensions` and the collab path)
- Modify: `src/components/editor/editor.tsx` (render `<EditorBubbleMenu>`; listen for `cairn:editor:open-link`)

- [ ] **Step 1: Configure the Link mark + add the shortcut extension in `extensions.ts`**

In `StarterKit.configure({...})` (the `baseExtensions` call, ~L54) add a `link` config so editor clicks don't navigate and pasted URLs autolink:

```ts
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', class: 'cairn-editor-link' },
      },
      ...(undoRedo ? {} : { undoRedo: false as const }),
    }),
```

Import the shortcut at the top:

```ts
import { EditorLinkShortcut } from './editor-link-shortcut';
```

Add `EditorLinkShortcut` to the returned array in `baseExtensions()` (near `SlashCommand`, e.g. right after it). Because `collabExtensions()` spreads `baseExtensions({ undoRedo: false })`, the shortcut is automatically present in the collab editor too — no separate add. Add a one-line entry to the Yjs-safety comment block:

```
 *  - cairnLinkShortcut — keymap-only Extension (no node/mark, no schema, no
 *                        node-local state); dispatches a window CustomEvent. SAFE
```

- [ ] **Step 2: Render the bubble menu + wire the open-link listener in `editor.tsx`**

Add the import:

```tsx
import { EditorBubbleMenu } from './editor-bubble-menu';
```

Add a small state + effect near the other editor effects (after the editor is created): open-link events flip a `linkRequested` counter that the bubble menu watches. Simplest path: have the bubble menu own its own `linkOpen` state (Task 2 already does) and expose an imperative open via a ref OR re-key. To keep Task 2 self-contained, pass an `openLinkSignal` prop:

```tsx
const [openLinkSignal, setOpenLinkSignal] = useState(0);
useEffect(() => {
  const onOpen = () => setOpenLinkSignal((n) => n + 1);
  window.addEventListener('cairn:editor:open-link', onOpen);
  return () => window.removeEventListener('cairn:editor:open-link', onOpen);
}, []);
```

Render the menu only for the editable, collab-bound editor (so viewers/read-only never get formatting controls), inside the `.relative.min-w-0.flex-1` wrapper next to `<EditorContent>`:

```tsx
{editor && effectiveEditable && (
  <EditorBubbleMenu editor={editor} openLinkSignal={openLinkSignal} />
)}
```

Then extend `EditorBubbleMenu` (Task 2) to accept `openLinkSignal?: number` and open the link input when it increments:

```tsx
export function EditorBubbleMenu({ editor, openLinkSignal = 0 }: { editor: Editor; openLinkSignal?: number }) {
  ...
  useEffect(() => {
    if (openLinkSignal > 0) setLinkOpen(true);
  }, [openLinkSignal]);
  ...
}
```

> Implementer note: if `openLinkSignal` fires while the selection is collapsed (e.g. user pressed ⌘⇧K with no selection), the `shouldShow` predicate keeps the bubble menu hidden, so nothing appears — acceptable. Optionally, on the signal, if the selection is empty you may select the current word; leave that as a follow-up unless trivial.

- [ ] **Step 3: Register the editor-scoped shortcut in the sheet registry**

So the shortcuts sheet's Editor group is non-empty and `⌘⇧K` is documented. In `src/components/shortcuts/app-shortcuts.ts`, add inside `ensureAppShortcuts()`:

```ts
  registerShortcut({
    id: 'editor.insertLink',
    keys: 'Mod+Shift+K',
    scope: 'editor',
    kind: 'action',
    labelKey: 'shortcut.insertLink',
    // No global run: the actual keystroke is handled by the TipTap
    // EditorLinkShortcut extension (only meaningful with editor focus). This
    // entry exists so the shortcut is listed in the ⌘/ sheet's Editor group.
    run: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cairn:editor:open-link'));
      }
    },
  });
```

> Note: `Mod+Shift+K` does not collide with any existing `scope: 'editor'` entry (the editor group is currently empty), so `registerShortcut`'s collision guard passes. It is in a different scope than the global `Mod+Shift+L/O/F/N`, so no cross-scope issue. Verify by running the registry test (Step 5).

- [ ] **Step 4: Add the link styling to the editor CSS**

Add a rule so `.cairn-editor-link` reads as a link in both themes (AA contrast). In `src/components/editor/code-highlight.css` (imported by the editor surface) or `blocks.css`, add:

```css
.cairn-editor-link {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: text; /* editable: clicking places the caret, not navigation */
}
```

> Implementer: confirm which CSS file the editable surface already imports (grep `code-highlight.css` / `blocks.css` imports in `editor.tsx` / `read-only-view.tsx`). Put the rule in the one that loads for the editable editor. For the read-only / public view, links SHOULD navigate — that view doesn't apply `openOnClick:false` the same way; leave existing read-only link behavior unchanged.

- [ ] **Step 5: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor tests/i18n tests/lib/shortcuts && pnpm lint && pnpm typecheck && pnpm build`
Expected: all green; build clean. The build catches the `@tiptap/react/menus` import resolving and any typed-route / SSR issue.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/extensions.ts src/components/editor/editor.tsx src/components/editor/editor-bubble-menu.tsx src/components/shortcuts/app-shortcuts.ts src/components/editor/code-highlight.css
git commit -m "feat(editor): wire bubble menu + link shortcut into editor + shortcuts sheet — Closes #116 Closes #117"
```

---

### Task 5: Manual QA checklist (human-run) + close issues

**Files:** none (verification only)

- [ ] **Step 1: Run `pnpm dev` and verify in-browser**

- Select text in a page → bubble menu appears above the selection with Bold/Italic/Strike/Code, a divider, Link, Clear.
- Each button toggles the mark; active marks show the `data-active` accent background.
- Click Link → themed input appears in the same menu; type `example.com`, press Enter → text becomes a link (`https://example.com`). Re-select the link → Link button shows active; open it → Remove (✕) clears it.
- Press `⌘⇧K` with a selection → link input opens. Press `⌘K` **with** a selection → link input opens (palette does NOT). Press `⌘K` with a **collapsed** caret → search palette opens (unchanged).
- Open the slash menu (`/`) over a selection edge → bubble menu does NOT overlap/steal focus (`shouldShow` suppression via `[data-tippy-root]`).
- Two browser windows on the same page (collab) → bold/link applied in one appears in the other (Yjs sync).
- Open `⌘/` shortcuts sheet → Editor group lists "Insert link  ⌘⇧K".
- Switch locale to `es` and `ar` → bubble button tooltips + link input placeholder are translated; in `ar` (RTL) the menu mirrors correctly and remains readable.
- Tab to a bubble-menu button → visible focus ring (AA); buttons are ≥44px (inspect: `min-h-11 min-w-11`).
- Viewer / reader-mode page → no bubble menu (editable-gated).

- [ ] **Step 2: Close the issues**

The Task 4 commit trailer closes #116 and #117 on merge. If anything in the QA checklist fails, file a follow-up rather than reopening scope here.

---

## Self-Review

- **Bubble-menu package:** `BubbleMenu` from `@tiptap/react/menus` — already installed transitively (`@tiptap/extension-bubble-menu@3.23.6` + `@floating-ui/*` under `.pnpm`). No `package.json` change needed. ✓
- **#116:** bubble menu with Bold/Italic/Strike/Code + Link + clear-formatting, reusing StarterKit marks; Yjs-safe (standard commands, no schema/node-local state); suppressed while slash/mention/page-link popups are open and over node selections / code blocks. ✓
- **#117:** new editor-scoped `⌘⇧K` (TipTap keymap + registry/sheet entry + bubble-menu tooltip) AND `⌘K` intercepted to mean link when a ranged selection is active in the editor (palette bails on non-empty editor selection; keymap returns `false` on collapsed caret so the palette still works). Decision documented in code + this plan. ✓
- **i18n:** 11 new keys added to en/es/ar; parity test guards them. ✓
- **A11y:** every control has `aria-label` + `title`, icons `aria-hidden`, `min-h-11 min-w-11` (≥44px), focus-visible ring, reuses AA-verified `accent`/`popover` tokens; link input is a themed popover. ✓
- **Read real files first:** plan reflects actual `extensions.ts` (StarterKit Link live, only `codeBlock` disabled), `editor.tsx` mount + `effectiveEditable` gate, `search-palette.tsx` global `⌘K` handler (the conflict source), empty `scope:'editor'` registry group, and existing locale key structure. ✓
- **No placeholders** except where the plan explicitly says "match the real import path / installed type shape" — the implementer reads the file first. ✓
