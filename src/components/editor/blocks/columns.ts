import { mergeAttributes, Node } from '@tiptap/core';

/**
 * Single-level multi-column layout.
 *
 * Yjs-safety: both nodes are pure structure (content + a derived `data-columns`
 * count) — no attrs that aren't rendered, no node-view, no local state. SAFE.
 *
 * Scope (spec decision #4): single level only. `column` is intentionally NOT in
 * the `block` group, so columns can't be nested in columns or placed loose.
 */
export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'cairn-column' }),
      0,
    ];
  },
});

export const ColumnList = Node.create({
  name: 'columnList',
  group: 'block',
  content: 'column{2,}',

  parseHTML() {
    return [{ tag: 'div[data-type="column-list"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column-list',
        'data-columns': String(node.childCount),
        class: 'cairn-column-list',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setColumns:
        (count = 2) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: Array.from({ length: Math.max(2, count) }, () => ({
              type: 'column',
              content: [{ type: 'paragraph' }],
            })),
          }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columnList: {
      setColumns: (count?: number) => ReturnType;
    };
  }
}
