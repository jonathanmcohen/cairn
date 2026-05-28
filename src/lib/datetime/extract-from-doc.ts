import { DateTime } from 'luxon';

/**
 * Minimal ProseMirror-JSON shape — keeps this module decoupled from the live
 * TipTap schema so it runs anywhere (server route, indexer, CLI).
 */
type PMNode = {
  type?: string;
  content?: PMNode[];
  attrs?: Record<string, unknown>;
};

/**
 * One extracted datetime instance. `epochMs` is the UTC millis since the
 * epoch; P29's range filter will compare against this value rather than the
 * ISO string (cheaper, and tz-independent).
 */
export type ExtractedDateTime = { iso: string; tz: string; epochMs: number };

/**
 * Walk a ProseMirror JSON doc and return every `datetime` block found, in
 * document order. Invalid ISO strings are silently skipped (the editor itself
 * should never write one, but we don't want a single corrupt doc to break the
 * index pipeline for an entire workspace).
 *
 * v0.9.0 G3 P20.
 */
export function extractDateTimesFromDoc(doc: PMNode): ExtractedDateTime[] {
  const out: ExtractedDateTime[] = [];
  function walk(n: PMNode): void {
    if (n.type === 'datetime') {
      const iso = String(n.attrs?.iso ?? '');
      const tz = String(n.attrs?.tz ?? 'UTC');
      const dt = DateTime.fromISO(iso, { zone: 'utc' });
      if (dt.isValid) {
        out.push({ iso, tz, epochMs: dt.toMillis() });
      }
    }
    for (const c of n.content ?? []) walk(c);
  }
  walk(doc);
  return out;
}
