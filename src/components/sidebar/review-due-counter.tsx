'use client';

import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Sidebar "Review due" link (v0.9.0 G3 P19). Polls `/api/flashcards/due` once
 * on mount and shows a count badge when the user has at least one card due.
 * The link routes to `/flashcards/study` for the full session.
 */
export function ReviewDueCounter(): React.JSX.Element | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/flashcards/due');
        if (!res.ok) return;
        const body = (await res.json()) as { due: unknown[] };
        if (!cancelled) setCount(Array.isArray(body.due) ? body.due.length : 0);
      } catch {
        // best-effort: hide on error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === null || count === 0) return null;

  return (
    <Link
      href="/flashcards/study"
      className="mb-2 flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
    >
      <span className="flex items-center gap-2">
        <GraduationCap aria-hidden="true" className="h-3 w-3" />
        Review due
      </span>
      <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{count}</span>
    </Link>
  );
}
