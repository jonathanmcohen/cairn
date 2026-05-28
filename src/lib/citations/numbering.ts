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
