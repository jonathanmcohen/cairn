import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DatabaseBlock } from '@/components/databases/database-block';

export const DatabaseNode = Node.create({
  name: 'database',
  group: 'block',
  atom: true,
  addAttributes() {
    return { databaseId: { default: null as string | null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-cairn-database]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-cairn-database': 'true' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlock);
  },
});
