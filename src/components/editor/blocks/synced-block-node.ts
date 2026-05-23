import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    syncedBlock: {
      /** Insert a fresh synced block (mints a new syncedBlockId). */
      setSyncedBlock: () => ReturnType;
    };
  }
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sb_${Math.random().toString(36).slice(2)}`;
}

/**
 * Schema-only definition of the synced block, with NO React node view. Shared
 * by the client `synced-block.ts` (which `.extend()`s it with a `ReactNodeView`)
 * and the server-side suggestion transform schema.
 */
export const SyncedBlockNode = Node.create({
  name: 'syncedBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      syncedBlockId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-synced-block-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-synced-block-id': HTMLAttributes.syncedBlockId }, 0];
  },

  addCommands() {
    return {
      setSyncedBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { syncedBlockId: newId() },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});
