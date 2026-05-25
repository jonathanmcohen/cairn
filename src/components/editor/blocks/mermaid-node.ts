import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Insert an empty Mermaid block (the user fills the DSL in the node view). */
      setMermaid: () => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the mermaid node, with NO React node view. Shared by
 * the client `mermaid.tsx` (which `.extend()`s it with a `ReactNodeView`) and the
 * server-side suggestion transform schema. Mermaid renders inline SVG client-side
 * via the lazy-loaded `mermaid` npm package — no iframe, no `frame-src` entry.
 */
export const MermaidNode = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-mermaid': '' })];
  },

  addCommands() {
    return {
      setMermaid:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { source: '' } }),
    };
  },
});
