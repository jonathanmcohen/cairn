export type CitationStyle = 'apa' | 'mla' | 'chicago';

export type CitationRef = {
  authors: string[];
  title: string;
  year: number;
  journal?: string;
  doi?: string;
  pubmedId?: string;
};

function joinAuthors(authors: string[], style: CitationStyle): string {
  if (authors.length === 0) return '';
  if (authors.length === 1) return authors[0]!;
  const sep = style === 'apa' ? ', & ' : style === 'chicago' ? ', and ' : ' and ';
  return `${authors.slice(0, -1).join(', ')}${sep}${authors[authors.length - 1]}`;
}

function suffix(ref: CitationRef): string {
  if (ref.doi) return ` https://doi.org/${ref.doi}`;
  if (ref.pubmedId) return ` PMID: ${ref.pubmedId}`;
  return '';
}

export function formatCitation(ref: CitationRef, style: CitationStyle): string {
  const authors = joinAuthors(ref.authors, style);
  const journal = ref.journal ?? '';
  if (style === 'apa') {
    const head = `${authors} (${ref.year}). ${ref.title}.`;
    const body = journal ? ` ${journal}.` : '';
    return `${head}${body}${suffix(ref)}`.trimEnd();
  }
  if (style === 'mla') {
    const head = `${authors} "${ref.title}."`;
    const body = journal ? ` ${journal}, ${ref.year}.` : ` ${ref.year}.`;
    const doiLine = ref.doi ? ` doi:${ref.doi}` : ref.pubmedId ? ` PMID: ${ref.pubmedId}` : '';
    return `${head}${body}${doiLine}`.trimEnd();
  }
  // chicago
  const head = `${authors} "${ref.title}."`;
  const body = journal ? ` ${journal} (${ref.year}).` : ` (${ref.year}).`;
  return `${head}${body}${suffix(ref)}`.trimEnd();
}
