import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    flashcard: {
      /**
       * Insert a flashcard block. `deckId` (v0.10.2 F2-D) is the INSERT-TIME
       * deck hint only — reconcile uses it for a brand-new card's deck, then the
       * card's deck is managed exclusively via the manage/decks UI. `deckTag` is
       * the legacy free-text label kept for back-compat parse of old content.
       */
      setFlashcard: (attrs: {
        front: string;
        back: string;
        deckTag?: string | null;
        deckId?: string | null;
      }) => ReturnType;
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
 *                row in `flashcard_cards` (legacy join / first reconcile of a
 *                new or pre-F2 block). Generated client-side at insert time.
 *  - `cardId`  — string | null. v0.10.2 F2-D. The canonical `flashcard_cards.id`
 *                this block references. Once present, reconcile resolves the
 *                card BY THIS ID (workspace-scoped) and the card is canonical:
 *                the block is a reference that carries front/back into the card.
 *                Backfilled by reconcile when a block has none (so the next save
 *                resolves by reference, not by `(page_id, block_id)`).
 *  - `deckId`  — string | null. v0.10.2 F2-D INSERT-TIME deck hint only. Used
 *                to set a brand-new card's deck; NEVER overwrites an existing
 *                card's deck (deck is managed via the manage/decks UI).
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
      front: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-front') ?? '',
        renderHTML: (attrs) => ({ 'data-front': String(attrs.front ?? '') }),
      },
      back: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-back') ?? '',
        renderHTML: (attrs) => ({ 'data-back': String(attrs.back ?? '') }),
      },
      deckTag: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-deck-tag') || null,
        renderHTML: (attrs) => ({ 'data-deck-tag': String(attrs.deckTag ?? '') }),
      },
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-block-id') || null,
        renderHTML: (attrs) => ({ 'data-block-id': String(attrs.blockId ?? '') }),
      },
      // v0.10.2 F2-D — canonical card reference + insert-time deck hint.
      cardId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-card-id') || null,
        renderHTML: (attrs) => ({ 'data-card-id': String(attrs.cardId ?? '') }),
      },
      deckId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-deck-id') || null,
        renderHTML: (attrs) => ({ 'data-deck-id': String(attrs.deckId ?? '') }),
      },
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
              // v0.10.2 F2-D — carry the chosen deck as the insert-time hint.
              deckId: attrs.deckId ?? null,
              // A freshly inserted block has no card yet; reconcile mints one
              // and backfills cardId on first save.
              cardId: null,
              // v0.9.11 #115 — mint here so the inserted node has a non-empty
              // data-block-id immediately, before any collab/REST save.
              blockId: crypto.randomUUID(),
            },
          }),
    };
  },
});
