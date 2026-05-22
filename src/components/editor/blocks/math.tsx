import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { useMemo, useState } from 'react';
import { renderMath } from '@/lib/editor/math-render';
import { MathBlockNode } from './math-node';

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

/** Client extension: the schema-only node + its React node view + KaTeX CSS. */
export const MathBlock = MathBlockNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },
});
