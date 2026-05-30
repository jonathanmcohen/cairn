# P26 — Code Block Polish + Mention Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the code-block editing affordances usable at scale (searchable language picker + a hover "Copy code" button) and make the `@`-mention surface scannable + self-explanatory (avatars in the suggestion list + documented `@` vs `[[`/`@@` triggers).

**Architecture:**
- **#105 (language picker filtering):** The themed `radix-ui` `Select` (`src/components/ui/select.tsx`) is a `listbox` and cannot host an editable text input inside its content without breaking its typeahead/keyboard model. Rather than retrofit `Select`, add a **self-contained filterable language picker** to `code-block-view.tsx` built on the project's already-installed `cmdk` (used by `src/components/search-palette.tsx` + `src/components/quick-capture/modal.tsx`) inside a small popover. It keeps the `combobox`-role trigger the existing test asserts on, adds a search box that filters `LANGUAGES` by label/value, and writes the chosen value through `updateAttributes` exactly as today — **no doc mutation on render**, so Yjs-safety is preserved.
- **#106 (Copy code):** A hover-revealed top-right icon button that copies `node.textContent` via the Clipboard API, reusing the **exact `CopyButton` success-feedback pattern** (`Copy` → `Check` for 1.5s) from `src/components/settings/copy-button.tsx`. It reads `node.textContent` only — **never writes to the doc** — so it is Yjs-safe even in read-only/locked pages.
- **#107 (mention avatars):** `MentionItem` already carries `{ id, name, email, image }`. Render the `Avatar` primitive (`src/components/ui/avatar.tsx`) in each `MentionList` row, reusing the `initials()` + `AvatarImage`/`AvatarFallback` pattern from `src/components/editor/presence-avatars.tsx`.
- **#108 (mention triggers):** `@` (member mention, `mention-extension.ts`) and `[[`/`@@` (page link / page mention, `page-link-suggestion.ts`) are **two separate `@tiptap/suggestion` plugins with distinct PluginKeys**. **Recommendation: DOCUMENT the two triggers** (low-risk) via a help row in both suggestion popups + an entry in the keyboard-shortcuts/help surface, and DEFER unifying `@` to surface people + pages as a flagged, larger follow-up (see Task 5). Unifying is out of scope for this patch.

**Tech Stack:** React 19, TipTap 3 React NodeView (`@tiptap/react`), `cmdk`, `radix-ui` (Avatar), `lucide-react`, the custom i18n (`useT` from `@/lib/i18n/provider`, messages in `messages/{en,es,ar}.json`), Tailwind v4, `cn()` from `src/lib/utils.ts`.

**Covers:** GH #105 (code-block language search), #106 (code-block copy), #107 (mention avatars), #108 (mention-trigger clarity — document, not unify).

**Reuses:** `src/components/settings/copy-button.tsx` (copy pattern), `src/components/ui/avatar.tsx` + `src/components/editor/presence-avatars.tsx#initials` (avatars), `src/components/ui/select.tsx` (kept as the fallback shape reference), `cmdk` (already a dep).

**Constraints (apply to every task):**
- **Yjs-safety:** the code-block NodeView already documents that the `language` attr is the ONLY persisted state and that the doc must NOT be mutated on render. The new picker still writes only via `updateAttributes`; the Copy button reads `node.textContent` and writes nothing.
- **i18n:** every new user-visible string goes through `useT()` with a new key added to `messages/en.json` AND mirrored into `messages/es.json` + `messages/ar.json` (the i18n Biome rule fails the build on a missing key — see v0.9.0 P31). No bare string literals in JSX.
- **Accessibility:** WCAG 2.1 AA. Interactive controls keep a visible focus ring and a **≥44px** touch target (`min-h-11`/`h-11` or `size-11` on the tap target; icon glyph may stay 16px inside). Avatars are decorative inside an already-labeled option row (`alt=""`/`aria-hidden` so they don't double-announce the name).

---

### Task 1: Filterable (typeahead) language picker for code blocks (#105)

**Files:**
- Modify: `src/components/editor/blocks/code-block-view.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Test: `tests/components/editor/code-block-language.test.tsx` (exists — keep passing; extend)

- [ ] **Step 1: Add the i18n keys**

Add to `messages/en.json` (and translate the values in `es.json`/`ar.json`; copy the English string verbatim if a translation is unknown — the build only requires the key to exist):

```json
{
  "editor.codeBlock.language": "Code language",
  "editor.codeBlock.searchLanguage": "Search languages…",
  "editor.codeBlock.noLanguage": "No language found",
  "editor.codeBlock.copy": "Copy code",
  "editor.codeBlock.copied": "Copied"
}
```

(Keys are flat dotted strings — that is the shape `messages/*.json` uses; see existing `locale.label`, `palette.actions`.)

- [ ] **Step 2: Extend the failing test**

Append a second case to `tests/components/editor/code-block-language.test.tsx`. The existing case asserts `findByRole('combobox', { name: /language/i })` — KEEP the trigger exposing that role+name. Add:

```tsx
import { fireEvent } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// Wrap the harness so useT() resolves (the NodeView calls useT):
function wrap(ui: React.ReactElement) {
  return <I18nProvider locale="en" messages={enMessages}>{ui}</I18nProvider>;
}
// …render with wrap(<Harness json={doc} />) in BOTH cases.

it('opens a searchable list and filters languages by typed text', async () => {
  render(wrap(<Harness json={{ type: 'doc', content: [
    { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print(1)' }] },
  ] }} />));
  const trigger = await screen.findByRole('combobox', { name: /language/i });
  fireEvent.click(trigger);
  const search = await screen.findByPlaceholderText(/search languages/i);
  fireEvent.change(search, { target: { value: 'rust' } });
  expect(screen.getByText('Rust')).toBeTruthy();
  expect(screen.queryByText('TypeScript')).toBeNull();
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/code-block-language.test.tsx`
Expected: FAIL — no search box yet (and the existing case fails until it's wrapped in `I18nProvider`).

- [ ] **Step 3: Implement the filterable picker**

Rewrite the editable-toolbar portion of `src/components/editor/blocks/code-block-view.tsx`. Keep the file's existing top-of-component comment block about Yjs-safety verbatim. Replace the `<Select>…</Select>` block with a `cmdk`-backed popover. Use `radix-ui`'s `Popover` (the unified `radix-ui` package is already installed — `import { Popover as PopoverPrimitive } from 'radix-ui'`) for positioning so it portals out of the `contentEditable={false}` toolbar cleanly, and `Command` from `cmdk` for the filtering. The trigger MUST keep `role="combobox"` and `aria-label={t('editor.codeBlock.language')}`.

```tsx
'use client';

import { Command } from 'cmdk';
import { Check, ChevronDown } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { LANGUAGES } from './code-block';

function LanguagePicker({
  value,
  label,
  onSelect,
}: {
  value: string;
  label: string;
  onSelect: (next: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.value === value) ?? LANGUAGES[0];
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        // role=combobox is implicit on a button with aria-haspopup=listbox in
        // the a11y tree; set it explicitly so the existing test query matches.
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'flex h-11 min-h-11 w-36 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-xs shadow-xs transition-colors',
          'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={4}
          className="z-50 w-48 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <Command className="flex flex-col">
            <Command.Input
              placeholder={t('editor.codeBlock.searchLanguage')}
              className="h-11 border-b bg-transparent px-3 text-sm outline-hidden placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
                {t('editor.codeBlock.noLanguage')}
              </Command.Empty>
              {LANGUAGES.map((l) => (
                <Command.Item
                  key={l.value}
                  value={`${l.label} ${l.value}`}
                  onSelect={() => {
                    onSelect(l.value);
                    setOpen(false);
                  }}
                  className="flex min-h-11 cursor-pointer select-none items-center justify-between rounded-sm px-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <span>{l.label}</span>
                  {l.value === value ? <Check className="h-4 w-4" /> : null}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
```

Then in `CodeBlockView`, render it inside the existing `contentEditable={false}` toolbar (the `editor.isEditable` branch), wiring `onSelect` to the same attr-write as before:

```tsx
  const t = useT();
  const language = (node.attrs.language as string | null) || 'auto';
  // …
      {editor.isEditable && (
        <div contentEditable={false} className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {/* Copy button is added in Task 2 — leave room here. */}
          <LanguagePicker
            value={language}
            label={t('editor.codeBlock.language')}
            onSelect={(v) => updateAttributes({ language: v === 'auto' ? null : v })}
          />
        </div>
      )}
```

Notes:
- `cmdk`'s `Command.Item` filters on its `value`; passing `` `${l.label} ${l.value}` `` lets "ts" match "TypeScript" (value `typescript`) and labels alike.
- Do NOT add node-local state for `language` — it stays read from `node.attrs` and written via `updateAttributes`. The only new local state is the popover's `open` (UI-only, not persisted) — Yjs-safe.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/code-block-language.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean. If `cmdk`'s `Command.Item` does not register in jsdom without a visible list, render the list unconditionally (cmdk does; no `shouldFilter={false}` needed — we rely on cmdk's built-in filtering).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/blocks/code-block-view.tsx messages/en.json messages/es.json messages/ar.json tests/components/editor/code-block-language.test.tsx
git commit -m "feat(editor): searchable code-block language picker — Closes #105"
```

---

### Task 2: Hover-revealed "Copy code" button on code blocks (#106)

**Files:**
- Modify: `src/components/editor/blocks/code-block-view.tsx`
- Test: `tests/components/editor/code-block-copy.test.tsx` (create)

i18n keys (`editor.codeBlock.copy`, `editor.codeBlock.copied`) were added in Task 1.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

function Harness({ json }: { json: object }) {
  const editor = useEditor({ extensions: baseExtensions(), content: json, immediatelyRender: false });
  return <EditorContent editor={editor} />;
}

describe('code block copy button', () => {
  it('copies the block text content to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <Harness json={{ type: 'doc', content: [
          { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print(1)' }] },
        ] }} />
      </I18nProvider>,
    );
    const copy = await screen.findByRole('button', { name: /copy code/i });
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print(1)'));
  });
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/code-block-copy.test.tsx`
Expected: FAIL — no Copy button yet.

- [ ] **Step 2: Implement the button (reuse the CopyButton feedback pattern)**

Add a local `CodeCopyButton` to `code-block-view.tsx` that mirrors `src/components/settings/copy-button.tsx` (the `copied` state + 1.5s reset + `Copy`/`Check` swap), but reads from a getter so it always copies the live text and never holds a stale snapshot:

```tsx
import { Check, Copy } from 'lucide-react';
// …
function CodeCopyButton({ getText, label, copiedLabel }: {
  getText: () => string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    await navigator.clipboard.writeText(getText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      aria-label={copied ? copiedLabel : label}
      onClick={() => void onCopy()}
      className={cn(
        'flex size-11 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity',
        'hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
        // reveal on block hover OR whenever focused (keyboard) — group set on the wrapper
        'group-hover/codeblock:opacity-100 focus-visible:opacity-100',
      )}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}
```

Wire it into the toolbar (left of the language picker) and add the hover group to the wrapper. The Copy button reads `node.textContent` — the rendered text of the code block — and **must not be gated on `editor.isEditable`** (read-only viewers want to copy too):

```tsx
    <NodeViewWrapper className="cairn-codeblock group/codeblock relative">
      <div contentEditable={false} className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <CodeCopyButton
          getText={() => node.textContent}
          label={t('editor.codeBlock.copy')}
          copiedLabel={t('editor.codeBlock.copied')}
        />
        {editor.isEditable && (
          <LanguagePicker /* …as Task 1… */ />
        )}
      </div>
      <pre className="hljs">{/* …NodeViewContent unchanged… */}</pre>
    </NodeViewWrapper>
```

Yjs note: `node.textContent` is a pure read of the current node; no transaction, no attr write — safe under collab and on locked pages.

- [ ] **Step 3: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/code-block-copy.test.tsx tests/components/editor/code-block-language.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/blocks/code-block-view.tsx tests/components/editor/code-block-copy.test.tsx
git commit -m "feat(editor): hover Copy-code button on code blocks — Closes #106"
```

---

### Task 3: Avatars in the `@`-mention suggestion list (#107)

**Files:**
- Modify: `src/components/editor/mention-list.tsx`
- Test: `tests/components/editor/mention-list.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MentionList, type MentionListRef } from '@/components/editor/mention-list';

afterEach(cleanup);

describe('<MentionList>', () => {
  it('shows an avatar fallback initial for a member without an image', () => {
    render(
      <MentionList
        ref={createRef<MentionListRef>()}
        items={[{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null }]}
        command={() => {}}
      />,
    );
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('AL')).toBeTruthy(); // initials fallback
  });
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/mention-list.test.tsx`
Expected: FAIL — no avatar/initials rendered.

- [ ] **Step 2: Implement — add the Avatar to each row**

Edit `src/components/editor/mention-list.tsx`. Add imports and an `initials()` helper copied from `presence-avatars.tsx` (keep them in sync — it is a 6-line pure function; do not over-abstract). Wrap the existing name/email block in a flex row with the avatar:

```tsx
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}
```

Replace the inner `<button>` contents:

```tsx
            <button
              type="button"
              tabIndex={-1}
              onClick={() => command(item)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${
                i === index ? 'bg-accent' : ''
              }`}
            >
              <Avatar size="sm" aria-hidden>
                {item.image ? <AvatarImage src={item.image} alt="" /> : null}
                <AvatarFallback>{initials(item.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.email}</span>
              </span>
            </button>
```

A11y: the avatar is decorative (`aria-hidden`, `alt=""`) because the row already announces the name + email; this prevents a double announcement to screen readers. The option row keeps its `role="option"` / `aria-selected` from the existing wrapper (unchanged).

- [ ] **Step 3: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/mention-list.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/mention-list.tsx tests/components/editor/mention-list.test.tsx
git commit -m "feat(editor): show avatars in @-mention suggestions — Closes #107"
```

---

### Task 4: Document the `@` vs `[[`/`@@` triggers in-product (#108 — documenting option)

**Decision:** Document, do not unify (rationale + the unify scope is in Task 5). Surface the two triggers where the user is already typing — the bottom of each suggestion popup — and in the help/shortcuts surface, all i18n'd.

**Files:**
- Modify: `src/components/editor/mention-list.tsx` (footer hint)
- Modify: `src/components/editor/page-link-list.tsx` (footer hint)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Modify: the editor group of the shortcuts/help sheet (the `shortcuts.group.editor` block — read `src/components/` for the component that renders `shortcuts.*` keys before editing; likely a shortcuts sheet under `src/components/`).
- Test: extend `tests/components/editor/mention-list.test.tsx`

- [ ] **Step 1: Add i18n keys**

```json
{
  "editor.mention.hintPeople": "@ for people · [[ for pages",
  "editor.pageLink.hintPages": "[[ or @@ for pages · @ for people"
}
```

Mirror into `es.json`/`ar.json`.

- [ ] **Step 2: Add a footer hint to both popups**

Both `MentionList` and `PageLinkList` are React components rendered through `ReactRenderer` inside the suggestion plugins — but they are NOT wrapped in `<I18nProvider>` by the editor's `ReactRenderer` mount. **Verify** whether `useT()` resolves there: grep where the editor (`src/components/editor/editor.tsx`) mounts and whether the provider wraps it. If `ReactRenderer` portals outside the provider, `useT()` will throw. Two safe options — pick based on what the verify shows:
  - (a) If the provider DOES wrap the editor subtree, call `useT()` in the list and render `t('editor.mention.hintPeople')`.
  - (b) If it does NOT (ReactRenderer mounts detached), pass the already-translated hint string into the list as a prop from the extension's `render()` (the extension factory runs in the editor tree). Add an optional `hint?: string` prop to `MentionList`/`PageLinkList` and thread it from `mention-extension.ts` / `page-link-suggestion.ts` where the editor's `t` is available, OR fall back to a plain constant if neither is available (still i18n-sourced at the call site).

Render at the bottom of the listbox container (outside `role="listbox"`, inside the popup `div`):

```tsx
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground" aria-hidden>
          {hint /* or t('editor.mention.hintPeople') */}
        </div>
```

Mark `aria-hidden` so it does not pollute the `aria-activedescendant` option set; it is a visual affordance.

- [ ] **Step 3: Add the triggers to the help/shortcuts surface**

In the component rendering the `shortcuts.group.editor` group, add two rows describing `@` → mention a person and `[[` / `@@` → link a page, using new keys `shortcut.mentionPerson` / `shortcut.linkPage` (added to all three message files). Match the existing row structure in that file (read it first).

- [ ] **Step 4: Extend the test**

Add to `tests/components/editor/mention-list.test.tsx` an assertion that the hint text renders (query by the resolved English string, e.g. `screen.getByText(/for pages/i)`). If option (b) is used, pass `hint="@ for people · [[ for pages"` in the test render.

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/ && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/mention-list.tsx src/components/editor/page-link-list.tsx messages/en.json messages/es.json messages/ar.json tests/components/editor/mention-list.test.tsx
git commit -m "docs(editor): surface @ vs [[/@@ trigger hints in suggestion popups — Closes #108"
```

---

### Task 5: Log the "unify `@` → people + pages" option as a flagged follow-up (#108 scope note)

**Files:**
- Modify: GitHub issue #108 (via `gh issue comment`)

- [ ] **Step 1: Record the decision + the deferred unify scope**

```bash
gh issue comment 108 --body "Resolved by documenting the two triggers in-product (suggestion-popup footer hints + editor shortcuts sheet) on branch \`patches/ux-audit-v0.9.4\` — low-risk, no behavior change.

DEFERRED (larger, flagged): unifying \`@\` to surface BOTH people and pages in one list. Scope if pursued later: merge the two \`@tiptap/suggestion\` plugins (currently separate PluginKeys \`mentionSuggestion\$\` and \`pageMentionSuggestion\$\`/\`pageLinkSuggestion\$\` — they MUST stay distinct keys or the editor crashes at mount), add a typed result union (member vs page) to a combined fetch (\`/api/workspaces/members\` + \`/api/workspaces/pages\`), branch the \`command\` to insert either a \`mention\` or a \`pageMention\` node, and redesign the list to section/label people vs pages. Risk: keyboard nav + the \`renderText\`/\`renderHTML\` serialization conventions differ per node type, and \`[[\` would likely remain a pages-only fast path. Not in this patch."
```

- [ ] **Step 2: Leave #108 open or close per the documenting commit trailer**

The Task 4 commit closes #108 (documenting is the chosen resolution). The comment above preserves the unify option as a future enhancement; open a fresh enhancement issue only if the user wants the unify tracked separately.

---

## Self-Review

- Spec coverage: #105 (searchable picker), #106 (copy button), #107 (avatars), #108 (documented + scope logged). ✓
- **Yjs-safety:** picker writes only via `updateAttributes`; copy reads `node.textContent` and never mutates the doc; new local state is UI-only (`open`, `copied`). ✓
- **i18n:** all new strings keyed in `messages/en.json` + mirrored to `es.json`/`ar.json`; no bare literals in JSX (Task 4 flags the `useT()`-vs-prop provider-scope check explicitly). ✓
- **A11y (AA + 44px):** trigger/search/copy/items all `min-h-11`/`size-11`; avatars decorative (`aria-hidden`, `alt=""`); hint rows `aria-hidden`; focus rings preserved. ✓
- **Reuse:** CopyButton pattern, Avatar primitive + `presence-avatars#initials`, existing `cmdk` dep. ✓
- **#108 recommendation:** DOCUMENT (low-risk, shipped here); UNIFY deferred and scoped (Task 5). ✓
- Placeholders flagged for the implementer to verify in-file: the shortcuts-sheet component path (Task 4 Step 3) and the `useT()`-provider-scope decision (Task 4 Step 2) — both call out "read the file first." ✓
