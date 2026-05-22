import { ReactNodeViewRenderer } from '@tiptap/react';
import { TableOfContentsNode } from './toc-node';
import { TableOfContentsNodeView } from './toc-node-view';

/**
 * A block-level atom that renders the document's heading outline as live links.
 * Client extension: the schema-only node + its React node view.
 */
export const TableOfContents = TableOfContentsNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsNodeView);
  },
});
