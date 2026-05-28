import type { CitationStyle } from './format';

type PMNode = {
  type: string;
  content?: PMNode[];
  attrs?: Record<string, unknown>;
};

export type AggregatedCitation = {
  id: string;
  formatted: string;
};

export function aggregateCitations(doc: PMNode, style: CitationStyle): AggregatedCitation[] {
  const seen = new Set<string>();
  const out: AggregatedCitation[] = [];
  function walk(n: PMNode): void {
    if (n.type === 'citation') {
      const id = String(n.attrs?.id ?? '');
      if (id && !seen.has(id)) {
        seen.add(id);
        const key =
          style === 'apa'
            ? 'formatted_apa'
            : style === 'mla'
              ? 'formatted_mla'
              : 'formatted_chicago';
        out.push({ id, formatted: String(n.attrs?.[key] ?? '') });
      }
    }
    for (const c of n.content ?? []) walk(c);
  }
  walk(doc);
  return out;
}
