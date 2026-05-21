import { PublicDatabaseView } from '@/components/databases/public-database-view';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

export const PublicDatabaseNode = Node.create({
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
    return ReactNodeViewRenderer(PublicDatabaseView);
  },
});
