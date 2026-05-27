'use client';

import {
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from '@tiptap/react';
import { useState } from 'react';
import { FlashcardNode } from '@/components/editor/blocks/flashcard-node';

/**
 * Lazy-loaded React node-view for the `flashcard` block (v0.9.0 G3 P19).
 *
 * Inline preview: shows `front`, a "Show back" toggle, and the deck tag when
 * present. The full study experience lives at `/flashcards/study`; this view
 * is just a visual peek so authors can verify what they wrote.
 */
function FlashcardNodeView({ node }: ReactNodeViewProps): JSX.Element {
  const [flipped, setFlipped] = useState(false);
  const front = String(node.attrs.front ?? '');
  const back = String(node.attrs.back ?? '');
  const deckTag = (node.attrs.deckTag as string | null) ?? null;

  return (
    <NodeViewWrapper className="my-2">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 text-xs text-muted-foreground">
          Flashcard{deckTag ? ` · ${deckTag}` : ''}
        </div>
        <div className="font-medium" data-testid="flashcard-face">
          {flipped ? back : front}
        </div>
        <button
          type="button"
          onClick={() => setFlipped((v) => !v)}
          className="mt-2 text-sm text-primary underline"
        >
          {flipped ? 'Show front' : 'Show back'}
        </button>
      </div>
    </NodeViewWrapper>
  );
}

const FlashcardExtension = FlashcardNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FlashcardNodeView);
  },
});

export default FlashcardExtension;
