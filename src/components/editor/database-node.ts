import { mergeAttributes, Node } from '@tiptap/core';

/**
 * Schema-only definition of the database node, with NO React node view. Shared
 * by the client `database-extension.ts` (which `.extend()`s it with a
 * `ReactNodeView`) and the server-side suggestion transform schema.
 */
export const DatabaseNodeSchema = Node.create({
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
});
