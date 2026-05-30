import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileView } from './blocks/file-view';
import { FileAttachment } from './file-extension';

/**
 * Client-only editor variant: the `fileAttachment` atom + its empty-state React
 * node-view. Kept separate from `file-extension.ts` so the bare `FileAttachment`
 * node (imported server-side by `@/components/editor/schema` →
 * `@/lib/suggestions/transform`) never pulls `@tiptap/react`'s client runtime
 * into a server bundle. Only `extensions.ts` imports this.
 */
export const FileAttachmentWithView = FileAttachment.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileView);
  },
});
