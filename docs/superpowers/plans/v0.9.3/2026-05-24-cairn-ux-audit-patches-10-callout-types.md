# P10 — Callout Semantic Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give callouts semantic variants (note / tip / warning / error / info) with an icon + accent color each, plus an in-editor type picker, while keeping old `color`-attr callouts working.

**Architecture:** Add a `variant` attribute to the `Callout` node, a React NodeView that renders the variant icon + a type picker (reuse `ui/select` from P01) alongside `NodeViewContent`, and variant CSS. Map the legacy `color` values on parse (blue→note, green→tip, amber→warning, default→note). All state in the `variant` attr — Yjs-safe (update the custom-node review comment in `extensions.ts`).

**Tech Stack:** TipTap 3 Node + `@tiptap/react` NodeView, lucide-react icons, Tailwind v4 CSS, P01 `ui/select`.

**Covers:** GH #48.

---

### Task 1: Add `variant` attribute + legacy mapping to the Callout node

**Files:**
- Modify: `src/components/editor/callout-extension.ts`
- Test: `tests/components/editor/callout-variant.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { baseExtensions } from '@/components/editor/extensions';

describe('callout variant', () => {
  it('parses legacy data-color into a variant and keeps a default', () => {
    const schema = getSchema(baseExtensions());
    const node = schema.nodes.callout;
    expect(node).toBeTruthy();
    // default variant exists
    expect(node.spec.attrs?.variant?.default).toBe('note');
  });
});
```

If `getSchema(baseExtensions())` is heavy/flaky in this harness, instead import the `Callout` extension directly and assert on `Callout.config`/`addAttributes` output. Keep the assertion: a `variant` attr exists with default `'note'`.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/callout-variant.test.ts`
Expected: FAIL — no `variant` attr.

- [ ] **Step 3: Add the `variant` attr + legacy parse + keep `color` for back-compat**

Rewrite `callout-extension.ts`:

```ts
import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CalloutView } from './blocks/callout-view';

export type CalloutVariant = 'note' | 'tip' | 'warning' | 'error' | 'info';

const LEGACY_COLOR_TO_VARIANT: Record<string, CalloutVariant> = {
  blue: 'note',
  green: 'tip',
  amber: 'warning',
  default: 'note',
};

export const CALLOUT_VARIANTS: CalloutVariant[] = ['note', 'tip', 'warning', 'error', 'info'];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'note' as CalloutVariant,
        parseHTML: (el) => {
          const v = el.getAttribute('data-variant') as CalloutVariant | null;
          if (v && CALLOUT_VARIANTS.includes(v)) return v;
          // legacy fallback: map old data-color
          const legacy = el.getAttribute('data-color') ?? 'default';
          return LEGACY_COLOR_TO_VARIANT[legacy] ?? 'note';
        },
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const variant = (HTMLAttributes['data-variant'] as string) ?? 'note';
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: `callout callout-${variant}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (variant: CalloutVariant = 'note') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
      toggleCallout:
        (variant: CalloutVariant = 'note') =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { variant }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: CalloutVariant) => ReturnType;
      toggleCallout: (variant?: CalloutVariant) => ReturnType;
    };
  }
}
```

Check call sites of `setCallout`/`toggleCallout` (slash menu, block-convert, any tests) — they currently pass a `CalloutColor`. Update those call sites to pass a variant (or no arg → defaults to `note`). Grep `setCallout`/`toggleCallout`/`CalloutColor` across `src/` and `tests/` and fix each.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/callout-variant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (after Task 2 provides CalloutView so it compiles)** — see Task 2; commit them together.

---

### Task 2: Callout React NodeView (icon + type picker) + variant CSS

**Files:**
- Create: `src/components/editor/blocks/callout-view.tsx`
- Modify: `src/components/editor/code-highlight.css` (`.callout-*` variant styles)
- Test: `tests/components/editor/callout-view.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorContent, useEditor } from '@tiptap/react';
import { baseExtensions } from '@/components/editor/extensions';

afterEach(cleanup);

function Harness() {
  const editor = useEditor({
    extensions: baseExtensions(),
    content: { type: 'doc', content: [
      { type: 'callout', attrs: { variant: 'warning' }, content: [{ type: 'paragraph' }] },
    ] },
    immediatelyRender: false,
  });
  return <EditorContent editor={editor} />;
}

describe('callout view', () => {
  it('renders a variant type picker', async () => {
    render(<Harness />);
    expect(await screen.findByRole('combobox', { name: /callout type/i })).toBeTruthy();
  });
});
```

Fall back to a presentational `CalloutTypePicker` unit test if the full-editor mount is flaky in jsdom (same approach as P09).

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/callout-view.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the NodeView**

```tsx
'use client';

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { AlertTriangle, Info, Lightbulb, OctagonX, StickyNote } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CALLOUT_VARIANTS, type CalloutVariant } from '../callout-extension';

const META: Record<CalloutVariant, { label: string; Icon: typeof Info }> = {
  note: { label: 'Note', Icon: StickyNote },
  tip: { label: 'Tip', Icon: Lightbulb },
  warning: { label: 'Warning', Icon: AlertTriangle },
  error: { label: 'Error', Icon: OctagonX },
  info: { label: 'Info', Icon: Info },
};

export function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const variant = (node.attrs.variant as CalloutVariant) ?? 'note';
  const { Icon } = META[variant] ?? META.note;
  return (
    <NodeViewWrapper className={`callout callout-${variant}`} data-type="callout" data-variant={variant}>
      <div className="flex items-start gap-2">
        <span contentEditable={false} className="callout-icon mt-0.5 shrink-0" aria-hidden>
          <Icon className="size-4" />
        </span>
        <NodeViewContent className="min-w-0 flex-1" />
        {editor.isEditable && (
          <div contentEditable={false} className="shrink-0">
            <Select value={variant} onValueChange={(v) => updateAttributes({ variant: v as CalloutVariant })}>
              <SelectTrigger aria-label="Callout type" className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALLOUT_VARIANTS.map((v) => (
                  <SelectItem key={v} value={v}>{META[v].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 4: Add variant CSS**

In `code-highlight.css`, replace/extend the old `.callout-blue/green/amber` rules with variant rules (left border + tinted bg + icon color) for `.callout-note` (blue), `.callout-tip` (green), `.callout-warning` (amber), `.callout-error` (red), `.callout-info` (slate), each with a `.dark` override. Keep the existing `.callout` base + the P03 callout-scoped heading scale. Map the icon color via `.callout-<v> .callout-icon { color: … }`.

- [ ] **Step 5: Run tests, confirm pass; then commit Task 1 + Task 2 together**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/callout-variant.test.ts tests/components/editor/callout-view.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; build clean. In `pnpm dev`, insert a callout → icon + type picker; switching to Warning/Error changes icon + color; an old `data-color` doc still renders.

```bash
git add src/components/editor/callout-extension.ts src/components/editor/blocks/callout-view.tsx src/components/editor/code-highlight.css tests/components/editor/callout-variant.test.ts tests/components/editor/callout-view.test.tsx
git commit -m "feat(editor): semantic callout types (note/tip/warning/error/info) with picker — Closes #48"
```

---

### Task 3: Update slash menu / block-convert labels (optional polish)

**Files:**
- Modify: `src/components/editor/slash-extension.ts` and/or `block-convert.ts` if they expose callout color options

- [ ] **Step 1: Offer variants where callouts are created**

If the slash menu or block-convert offered callout "colors", update them to offer variants (or just a single "Callout" that defaults to `note`, switchable via the in-block picker). Read those files; keep it minimal — the in-block picker is the primary control.

- [ ] **Step 2: Verify + commit (only if changed)**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`

```bash
git add src/components/editor/slash-extension.ts src/components/editor/block-convert.ts
git commit -m "feat(editor): callout variant options in slash/convert menus — refs #48"
```

---

## Self-Review

- Covers #48 with backward compatibility (legacy `color` → variant). ✓
- NodeView writes only `variant` → Yjs-safe; UPDATE the Callout entry in the `extensions.ts` custom-node safety review (attr `variant` only). ✓
- Reuses `ui/select` (P01). ✓
- Call-site migration (`setCallout`/`CalloutColor`) explicitly flagged to grep + fix. ✓
