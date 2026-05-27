'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type DueCard = {
  id: string;
  front: string;
  back: string;
  deckTag: string | null;
};

/**
 * Client-side study session (v0.9.0 G3 P19). Fetches the user's due queue via
 * `/api/flashcards/due`, shows one card at a time, and POSTs each grade to
 * `/api/flashcards/grade`. Optional `?deck=<tag>` filter narrows the queue.
 */
export default function StudyPage(): JSX.Element {
  const params = useSearchParams();
  const deck = params.get('deck');
  const [queue, setQueue] = useState<DueCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = `/api/flashcards/due${deck ? `?deck=${encodeURIComponent(deck)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (!cancelled) setQueue([]);
        return;
      }
      const body = (await res.json()) as { due: DueCard[] };
      if (!cancelled) setQueue(body.due);
    })();
    return () => {
      cancelled = true;
    };
  }, [deck]);

  if (queue === null) {
    return <div className="mx-auto max-w-xl p-8 text-center text-muted-foreground">Loading…</div>;
  }
  if (queue.length === 0) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-xl font-medium mb-2">No cards due</h1>
        <p className="text-muted-foreground">
          Add a flashcard to any page with the `/flashcard` slash command.
        </p>
      </div>
    );
  }
  if (idx >= queue.length) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-xl font-medium mb-2">Session complete</h1>
        <p className="text-muted-foreground">Reviewed {queue.length} card(s).</p>
      </div>
    );
  }

  const card = queue[idx]!;

  async function grade(g: 0 | 1 | 2 | 3): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/flashcards/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardId: card.id, grade: g }),
      });
    } finally {
      setShowBack(false);
      setIdx((i) => i + 1);
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <div className="text-sm text-muted-foreground">
        Card {idx + 1} of {queue.length}
        {deck ? ` · deck: ${deck}` : card.deckTag ? ` · ${card.deckTag}` : ''}
      </div>
      <div className="min-h-48 rounded-lg border bg-card p-8 text-center text-lg">
        {showBack ? card.back : card.front}
      </div>
      {!showBack ? (
        <button
          type="button"
          className="w-full rounded bg-primary px-4 py-2 text-primary-foreground"
          onClick={() => setShowBack(true)}
        >
          Show answer
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => grade(0)}
            disabled={submitting}
            className="rounded border px-3 py-2 hover:bg-accent disabled:opacity-50"
          >
            Again
          </button>
          <button
            type="button"
            onClick={() => grade(1)}
            disabled={submitting}
            className="rounded border px-3 py-2 hover:bg-accent disabled:opacity-50"
          >
            Hard
          </button>
          <button
            type="button"
            onClick={() => grade(2)}
            disabled={submitting}
            className="rounded border px-3 py-2 hover:bg-accent disabled:opacity-50"
          >
            Good
          </button>
          <button
            type="button"
            onClick={() => grade(3)}
            disabled={submitting}
            className="rounded border px-3 py-2 hover:bg-accent disabled:opacity-50"
          >
            Easy
          </button>
        </div>
      )}
    </div>
  );
}
