import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawio: {
      /** Insert an empty drawio block (the user pastes XML or a URL in the view). */
      setDrawio: () => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the drawio node, with NO React node view. The
 * client `drawio.tsx` extends it with a `ReactNodeView` that renders a
 * sandboxed iframe pointing at `https://viewer.diagrams.net` (viewer-only).
 * Editing happens via the in-app textarea/URL form, NOT inside the iframe.
 */
export const DrawioNode = Node.create({
  name: 'drawio',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: { default: '' },
      sourceUrl: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-drawio]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-drawio': '' })];
  },

  addCommands() {
    return {
      setDrawio:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { source: '', sourceUrl: '' },
          }),
    };
  },
});
