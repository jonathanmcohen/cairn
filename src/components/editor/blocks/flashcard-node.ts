import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    flashcard: {
      /** Insert a flashcard block with the given front/back/deck. */
      setFlashcard: (attrs: { front: string; back: string; deckTag?: string | null }) => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the `flashcard` block node (v0.9.0 G3 P19).
 *
 * Attrs:
 *  - `front`   — string. The question / prompt.
 *  - `back`    — string. The answer.
 *  - `deckTag` — string | null. Optional grouping tag used by the study route's
 *                `?deck=` filter and by the daily due-notif scan.
 *  - `blockId` — string | null. Stable client-generated id; the page-save
 *                reconcile loop uses `(page_id, block_id)` to find the matching
 *                row in `flashcard_cards`. Generated server-side at save time
 *                if missing (see reconcile-on-save handler).
 *
 * Block atom: TipTap treats this as opaque; the React node-view (lazy) owns
 * the inline preview + flip button. Keeping this file React-free lets the
 * server-side schema parser load it without pulling in React.
 */
export const FlashcardNode = Node.create({
  name: 'flashcard',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      front: { default: '' },
      back: { default: '' },
      deckTag: { default: null },
      blockId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-flashcard]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-flashcard': '1',
        'data-front': String(HTMLAttributes.front ?? ''),
        'data-back': String(HTMLAttributes.back ?? ''),
        'data-deck-tag': String(HTMLAttributes.deckTag ?? ''),
        'data-block-id': String(HTMLAttributes.blockId ?? ''),
        class: 'cairn-flashcard',
      }),
    ];
  },

  addCommands() {
    return {
      setFlashcard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              front: attrs.front,
              back: attrs.back,
              deckTag: attrs.deckTag ?? null,
              blockId: null,
            },
          }),
    };
  },
});
