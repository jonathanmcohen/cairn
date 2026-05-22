import { InputRule, mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { useMemo, useState } from 'react';
import { renderMath } from '@/lib/editor/math-render';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      setMath: (attrs: { latex: string; display?: boolean }) => ReturnType;
    };
  }
}

function MathView({ node, editor, updateAttributes }: NodeViewProps) {
  const latex = (node.attrs.latex as string) ?? '';
  const display = Boolean(node.attrs.display);
  const [editing, setEditing] = useState(false);

  const html = useMemo(() => renderMath(latex, display), [latex, display]);

  const Wrapper = display ? 'div' : 'span';

  if (editing && editor.isEditable) {
    return (
      <NodeViewWrapper as={display ? 'div' : 'span'} className={display ? 'my-2 block' : 'inline'}>
        <textarea
          // biome-ignore lint/a11y/noAutofocus: editing affordance — focus the latex field when the user clicks into edit mode.
          autoFocus
          value={latex}
          onChange={(e) => updateAttributes({ latex: e.target.value })}
          onBlur={() => setEditing(false)}
          className="w-full rounded border bg-background p-2 font-mono text-xs"
          rows={display ? 3 : 1}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={display ? 'div' : 'span'}
      className={display ? 'my-2 block text-center' : 'inline'}
    >
      <Wrapper
        // KaTeX output is sanitized HTML from a trusted local renderer (no remote input).
        // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX-rendered math, local-only.
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={() => editor.isEditable && setEditing(true)}
        className={editor.isEditable ? 'cursor-pointer' : undefined}
      />
    </NodeViewWrapper>
  );
}

// Named `MathBlock` (not `Math`) to avoid shadowing the JS global `Math`
// (Biome `noShadowRestrictedNames`). The TipTap node `name` is still `math`.
export const MathBlock = Node.create({
  name: 'math',
  inline: true, // a single node serves inline; block uses display:true + group below
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: '' },
      display: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math]' }, { tag: 'div[data-math]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const tag = HTMLAttributes.display ? 'div' : 'span';
    return [tag, mergeAttributes(HTMLAttributes, { 'data-math': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },

  addInputRules() {
    const name = this.name;
    return [
      new InputRule({
        find: /\$\$([^$]+)\$\$$/,
        handler: ({ range, match, commands }) => {
          commands.insertContentAt(range, {
            type: name,
            attrs: { latex: match[1] ?? '', display: true },
          });
        },
      }),
      new InputRule({
        find: /\$([^$]+)\$$/,
        handler: ({ range, match, commands }) => {
          commands.insertContentAt(range, {
            type: name,
            attrs: { latex: match[1] ?? '', display: false },
          });
        },
      }),
    ];
  },

  addCommands() {
    return {
      setMath:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex: attrs.latex, display: attrs.display ?? false },
          }),
    };
  },
});
