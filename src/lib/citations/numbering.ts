type PMNode = {
  type: string;
  content?: PMNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
};

export type FootnoteEntry = { number: number; id: string; content: string };

export function numberFootnotes(doc: PMNode): {
  map: Record<string, number>;
  ordered: FootnoteEntry[];
} {
  const map: Record<string, number> = {};
  const ordered: FootnoteEntry[] = [];

  function walk(node: PMNode): void {
    for (const m of node.marks ?? []) {
      if (m.type !== 'footnote') continue;
      const id = String(m.attrs?.id ?? '');
      const content = String(m.attrs?.content ?? '');
      if (!id || id in map) continue;
      const number = ordered.length + 1;
      map[id] = number;
      ordered.push({ number, id, content });
    }
    for (const child of node.content ?? []) walk(child);
  }

  walk(doc);
  return { map, ordered };
}

export type CitationNumberEntry = { number: number; id: string };

/**
 * v0.10.2 P5 — 1-based citation numbering: dedup by `id`, first-appearance
 * document order. MUST stay aligned with `aggregateCitations()`
 * (lib/citations/aggregate.ts) — the bibliography `<ol>` renders entries in
 * the same dedup'd id order, so chip `[n]` always points at bibliography
 * entry n. Citations without an id are skipped (they have no bibliography
 * entry either).
 */
export function numberCitations(doc: PMNode): {
  map: Record<string, number>;
  ordered: CitationNumberEntry[];
} {
  const map: Record<string, number> = {};
  const ordered: CitationNumberEntry[] = [];

  function walk(node: PMNode): void {
    if (node.type === 'citation') {
      const id = String(node.attrs?.id ?? '');
      if (id && !(id in map)) {
        const number = ordered.length + 1;
        map[id] = number;
        ordered.push({ number, id });
      }
    }
    for (const child of node.content ?? []) walk(child);
  }

  walk(doc);
  return { map, ordered };
}
