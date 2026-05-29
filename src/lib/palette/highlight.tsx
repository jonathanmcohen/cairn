import type * as React from 'react';

/** Escape regex metacharacters so the query is matched literally. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` on case-insensitive occurrences of `query` and wrap each match
 * in a themed <mark>. Returns plain React nodes (no dangerouslySetInnerHTML),
 * so user/query input is never interpreted as HTML.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  // Capturing group → String.split yields alternating non-match/match segments.
  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const parts = text.split(re);
  const lowerQ = q.toLowerCase();
  return parts.map((part, i) =>
    part.toLowerCase() === lowerQ ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional and stable per render
      <mark key={i} className="rounded-[2px] bg-transparent font-semibold text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
