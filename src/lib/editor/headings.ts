/**
 * Pure heading extraction for the table-of-contents node + outline panel.
 * No React, no editor instance — operates on ProseMirror/TipTap JSON.
 */

export type HeadingEntry = {
  /** Heading level, 1–4 (extended in v0.9 P28; StarterKit is configured for levels [1,2,3,4]). */
  level: number;
  /** Concatenated plain-text content of the heading. */
  text: string;
  /** Stable, deduped, url-safe slug used as the scroll anchor id. */
  id: string;
};

type PmNode = {
  type?: string;
  attrs?: Record<string, unknown> | null;
  text?: string;
  content?: PmNode[];
};

/** URL-safe slug; falls back to "section" when nothing usable remains. */
export function headingSlug(text: string): string {
  const slug = text
    // Drop anything outside printable ASCII (accented/precomposed chars, etc.)
    // entirely so adjacent base letters stay joined (e.g. "déjà" -> "dj"),
    // rather than decomposing and keeping the base letters.
    .replace(/[^\x20-\x7e]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'section';
}

/** Concatenate the text content of a node subtree. */
function textOf(node: PmNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map(textOf).join('');
}

/**
 * Collect all `heading` nodes in document order with their level, text, and a
 * stable deduped slug id. Recurses into container nodes (callout, columns, etc.)
 * so headings nested in blocks still appear.
 */
export function collectHeadings(doc: unknown): HeadingEntry[] {
  const root = doc as PmNode | null;
  if (!root || !Array.isArray(root.content)) return [];

  const out: Omit<HeadingEntry, 'id'>[] = [];
  const walk = (node: PmNode): void => {
    if (node.type === 'heading') {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
      // v0.9 P28: extend to h4. Drop h5/h6 — outline sidebar (and inline TOC
      // block) only render the four levels covered by StarterKit's keyboard
      // shortcuts.
      if (level >= 1 && level <= 4) {
        out.push({ level, text: textOf(node).trim() });
      }
      return; // headings don't nest headings
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child);
  };
  for (const child of root.content) walk(child);

  // Dedupe slugs: first wins bare, collisions get -1, -2, …
  const seen = new Map<string, number>();
  return out.map((h) => {
    const base = headingSlug(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...h, id: n === 0 ? base : `${base}-${n}` };
  });
}
