import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    divider: {
      /** Insert an atomic horizontal-rule divider block. */
      setDivider: () => ReturnType;
    };
  }
}

/**
 * v0.8.0 P24 divider node — an atomic block rendered as `<hr>`. The block
 * carries no attrs and no node-view (HTML-only render), so it is Yjs-safe
 * by construction. Public-page rendering inherits `renderHTML` unchanged
 * (no signed-URL handling needed).
 *
 * Distinct from StarterKit's `horizontalRule` (which we also keep enabled
 * for markdown import/export compatibility): this is an explicit cairn
 * block so slash-command + future styling hooks have a stable target.
 */
export const DividerNode = Node.create({
  name: 'divider',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'hr[data-cairn-divider]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'hr',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-divider': '',
        class: 'cairn-divider my-4 border-border',
      }),
    ];
  },

  addCommands() {
    return {
      setDivider:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});
