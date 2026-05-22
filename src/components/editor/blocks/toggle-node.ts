import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the toggle node, with NO React node view. Shared by
 * the client `toggle.ts` (which `.extend()`s it with a `ReactNodeView`) and the
 * server-side suggestion transform schema.
 *
 * Yjs-safety (the v0.3.0 custom-node rule): the ONLY mutable state is the
 * `open` attr.
 */
export const ToggleNode = Node.create({
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
