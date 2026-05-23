import { ReactNodeViewRenderer } from '@tiptap/react';
import { ToggleNode } from './toggle-node';
import { ToggleView } from './toggle-view';

/**
 * A collapsible block holding child content.
 *
 * Client extension: the schema-only node + its React node view. The ONLY
 * mutable state is the `open` attr (written via `updateAttributes`), so
 * y-prosemirror syncs it like any attr — no node-view-local React state.
 */
export const Toggle = ToggleNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
});
