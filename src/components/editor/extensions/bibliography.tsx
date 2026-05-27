import { aggregateCitations } from '@/lib/citations/aggregate';
import type { CitationStyle } from '@/lib/citations/format';

/**
 * v0.9.0 G3 P18 — Bibliography aggregator block.
 *
 * Pure-presentational. Walks the page's ProseMirror JSON, collects every
 * `citation` node (dedup by id, preserves first-appearance order), and emits
 * an `<ol role="doc-bibliography">` keyed by id. Renders nothing when the doc
 * has no citations — keeps the published page tidy when no references exist.
 *
 * Used by:
 *  - `src/app/p/[slug]/page.tsx` (public renderer, appended after the body).
 *  - In-editor read-only view (TODO P21+ — exposed component for reuse).
 */
export function Bibliography({
  doc,
  style,
}: {
  doc: unknown;
  style: CitationStyle;
}): React.ReactNode {
  const refs = aggregateCitations(doc as { type: string }, style);
  if (refs.length === 0) return null;
  return (
    <section className="mt-8 border-t pt-4">
      <h2 className="mb-2 text-xl font-semibold">References</h2>
      <ol role="doc-bibliography" className="list-decimal space-y-1 pl-6">
        {refs.map((r) => (
          <li key={r.id}>{r.formatted}</li>
        ))}
      </ol>
    </section>
  );
}
