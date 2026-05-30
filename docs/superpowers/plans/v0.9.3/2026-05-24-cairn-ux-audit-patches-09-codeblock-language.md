# P09 — Code Block Language Selector + Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give code blocks a styled language selector that drives lowlight syntax highlighting, plus best-effort auto-detection so untagged code still highlights.

**Architecture:** Extend the existing `CodeBlockLowlight` with a React NodeView (`ReactNodeViewRenderer`) that renders a language dropdown (the new `ui/select` from P01) bound to the node's `language` attribute, with `<NodeViewContent as="code">` inside a `<pre>` for the editable code. All state lives in the `language` attr (no node-local state) — Yjs-safe, matching the documented custom-node review in `extensions.ts`.

**Tech Stack:** TipTap 3, `@tiptap/extension-code-block-lowlight`, `lowlight` (common langs), `@tiptap/react` NodeView, the P01 `ui/select`.

**Covers:** GH #47.

**Reuses:** `src/components/ui/select.tsx` (P01). Highlight theme already in `src/components/editor/code-highlight.css` (`.hljs-*`).

---

### Task 1: Code-block React NodeView with language selector

**Files:**
- Create: `src/components/editor/blocks/code-block-view.tsx`
- Create: `src/components/editor/blocks/code-block.ts` (the extended node)
- Modify: `src/components/editor/extensions.ts` (swap `CodeBlockLowlight.configure(...)` for the extended node) and `src/components/editor/schema.ts` (same swap, for server-side parsing parity)
- Test: `tests/components/editor/code-block-language.test.tsx`

- [ ] **Step 1: Decide the language list**

Export a stable list of lowlight `common` language ids + labels from the new `code-block.ts`. Read what `common` provides (e.g. `import { common } from 'lowlight'` → `Object.keys(common)`), but pin a curated, ordered subset for the UI (plaintext + the popular ~20: ts, tsx, js, jsx, json, html, css, bash, python, go, rust, java, c, cpp, sql, yaml, markdown, diff, php, ruby) plus a final `Auto` option. Keep `plaintext` as the explicit no-highlight value.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorContent, useEditor } from '@tiptap/react';
import { baseExtensions } from '@/components/editor/extensions';

afterEach(cleanup);

function Harness({ json }: { json: object }) {
  const editor = useEditor({ extensions: baseExtensions(), content: json, immediatelyRender: false });
  return <EditorContent editor={editor} />;
}

describe('code block language selector', () => {
  it('renders a language control reflecting the node language attr', async () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print(1)' }] }],
    };
    render(<Harness json={doc} />);
    // The NodeView exposes the current language via an accessible control.
    expect(await screen.findByRole('combobox', { name: /language/i })).toBeTruthy();
  });
});
```

If mounting a full editor in jsdom is flaky, instead unit-test the `LANGUAGES` export + a thin presentational `CodeBlockLanguagePicker` component (render it directly with a `value`/`onChange`) — pick whichever is reliable; keep the assertion that the picker shows the current language.

- [ ] **Step 3: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/code-block-language.test.tsx`
Expected: FAIL — no combobox (no NodeView yet).

- [ ] **Step 4: Implement the NodeView**

`code-block-view.tsx`:

```tsx
'use client';

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LANGUAGES } from './code-block';

export function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const language = (node.attrs.language as string) || 'auto';
  return (
    <NodeViewWrapper className="cairn-codeblock relative">
      {editor.isEditable && (
        <div contentEditable={false} className="absolute right-2 top-2 z-10">
          <Select value={language} onValueChange={(v) => updateAttributes({ language: v === 'auto' ? null : v })}>
            <SelectTrigger aria-label="Code language" className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <pre className="hljs">
        <NodeViewContent as="code" className={language && language !== 'auto' ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}
```

`code-block.ts`:

```ts
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { createLowlight } from 'lowlight';
import { CodeBlockView } from './code-block-view';

export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'plaintext', label: 'Plain text' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'tsx', label: 'TSX' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'bash', label: 'Bash' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'diff', label: 'Diff' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
];

// Factory so both extensions.ts and schema.ts share one lowlight instance
// (they each already create one via createLowlight(common)).
export function createCairnCodeBlock(lowlight: ReturnType<typeof createLowlight>) {
  return CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
  }).configure({ lowlight });
}
```

In `extensions.ts`: replace `CodeBlockLowlight.configure({ lowlight })` with `createCairnCodeBlock(lowlight)` (import the factory; the local `lowlight = createLowlight(common)` stays). Do the same swap in `schema.ts` — BUT `schema.ts` is used for server-side HTML/JSON parsing where React NodeViews don't render; keep `schema.ts` on the plain `CodeBlockLowlight.configure({ lowlight })` (no NodeView) so server parsing is unaffected. Only `extensions.ts` (the interactive editor) gets the NodeView. Confirm this split by reading how `schema.ts` is consumed.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/code-block-language.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify the build + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. In `pnpm dev`, a code block shows a language dropdown; selecting e.g. Python highlights `print()`.

```bash
git add src/components/editor/blocks/code-block-view.tsx src/components/editor/blocks/code-block.ts src/components/editor/extensions.ts tests/components/editor/code-block-language.test.tsx
git commit -m "feat(editor): code block language selector + lowlight highlighting — refs #47"
```

---

### Task 2: Best-effort auto-detect for untagged code

**Files:**
- Modify: `src/components/editor/blocks/code-block-view.tsx`

- [ ] **Step 1: When language is `auto`/null, detect once from content**

In `CodeBlockView`, when `language` is `auto`/null and the node has non-trivial text, run lowlight's auto-detect to pick a language for display highlighting WITHOUT mutating the doc (so it stays Yjs-safe and doesn't create churn). Apply the detected class to the `<code>` for rendering only; leave the stored attr as `auto`/null. Read `@tiptap/extension-code-block-lowlight`'s behavior first — if the extension already highlights `plaintext` when language is null, "Auto" can simply mean "let the extension decide" and this task reduces to ensuring the Auto option maps to null and documents that highlighting applies once a language is chosen.

Keep it simple and correct: if true auto-detection is non-trivial with this extension version, ship the selector (Task 1) as the core fix and have "Auto" = no explicit language (extension default). Document that in the commit.

- [ ] **Step 2: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`

```bash
git add src/components/editor/blocks/code-block-view.tsx
git commit -m "feat(editor): auto language option for code blocks — Closes #47"
```

---

## Self-Review

- Covers #47 (selector + highlighting; auto best-effort). ✓
- NodeView writes only the `language` attr → Yjs-safe; ADD a one-line entry to the custom-node safety review comment in `extensions.ts` for the extended code block (attr `language` only). ✓
- `schema.ts` (server parse) intentionally stays NodeView-free. ✓
- Reuses `ui/select` (P01) — DRY. ✓
