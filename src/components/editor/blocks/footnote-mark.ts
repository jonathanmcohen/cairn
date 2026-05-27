import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * v0.9.0 G3 P18 — Inline footnote mark.
 *
 * Wraps text inline. Renders as `<sup data-footnote-id data-footnote-content
 * role="doc-noteref">` (WAI-ARIA DPUB role for a footnote reference). Numbering
 * is computed at render time by `src/lib/citations/numbering.ts#numberFootnotes`
 * walking the ProseMirror JSON in document order; the mark itself only stores
 * the stable `id` + author-supplied `content`. Both attrs are plain strings
 * (Yjs-safe — no node-local state).
 */
export const FootnoteMark = Mark.create({
  name: 'footnote',
  inclusive: false,

  addAttributes() {
    return {
      id: { default: null },
      content: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-footnote-id': HTMLAttributes.id ?? '',
        'data-footnote-content': HTMLAttributes.content ?? '',
        role: 'doc-noteref',
        class: 'cairn-footnote',
      }),
      0,
    ];
  },
});
