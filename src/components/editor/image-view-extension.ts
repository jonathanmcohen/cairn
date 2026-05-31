import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageView } from './blocks/image-view';
import { CairnImage } from './image-extension';

/**
 * Client-only editor variant: the `cairnImage` atom + its empty-state React
 * node-view. Kept in a SEPARATE module from `image-extension.ts` so the bare
 * `CairnImage` node (imported server-side by `@/components/editor/schema` →
 * `@/lib/suggestions/transform`) never drags `@tiptap/react`'s client
 * `EditorContent`/NodeView runtime into a server bundle (that crashed the
 * Next build with `Class extends value undefined` during page-data collection).
 * Only `extensions.ts` (the live client editor) imports this.
 */
export const CairnImageWithView = CairnImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
