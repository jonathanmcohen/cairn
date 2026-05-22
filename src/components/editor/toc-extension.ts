import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TableOfContentsNodeView } from './toc-node-view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Insert a table-of-contents block. */
      insertTableOfContents: () => ReturnType;
    };
  }
}

/**
 * A block-level atom that renders the document's heading outline as live links.
 * Yjs-safe: no attributes, no node-local state — the node-view derives everything
 * from the shared doc at render time (see the custom-node review in extensions.ts).
 */
export const TableOfContents = Node.create({
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

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsNodeView);
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
