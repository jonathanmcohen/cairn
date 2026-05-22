import { ReactNodeViewRenderer } from '@tiptap/react';
import { DatabaseBlock } from '@/components/databases/database-block';
import { DatabaseNodeSchema } from './database-node';

/** Client extension: the schema-only node + its React node view. */
export const DatabaseNode = DatabaseNodeSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlock);
  },
});
