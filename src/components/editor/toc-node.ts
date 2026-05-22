import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Insert a table-of-contents block. */
      insertTableOfContents: () => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the table-of-contents node, with NO React node
 * view. Shared by the client `toc-extension.ts` (which `.extend()`s it with a
 * `ReactNodeView`) and the server-side suggestion transform schema.
 *
 * Yjs-safe: no attributes, no node-local state — the node-view derives
 * everything from the shared doc at render time (see extensions.ts review).
 */
export const TableOfContentsNode = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML() {
    return ['div', { 'data-type': 'table-of-contents' }];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});
