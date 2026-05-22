import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ToggleView } from './toggle-view';

/**
 * A collapsible block holding child content.
 *
 * Yjs-safety (the v0.3.0 custom-node rule): the ONLY mutable state is the
 * `open` attr. The React node-view writes it via `updateAttributes`, so
 * y-prosemirror syncs it like any attr — no node-view-local React state.
 */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false',
        renderHTML: (attrs) => ({ 'data-open': attrs.open ? 'true' : 'false' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Static (export / read-only without the node-view) render: a details-like
    // wrapper. Children render in the content hole (`0`).
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'toggle', class: 'cairn-toggle' }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
    };
  }
}
