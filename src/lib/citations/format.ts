import type { CitationAuthor, CitationMeta } from './types';

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

// ─── v0.9.0 G3 P21 — CitationMeta formatters ────────────────────────────────
// The P18 `formatCitation` helper above operates on the legacy `CitationRef`
// (string authors, mandatory year). P21 introduces a richer normalized shape
// (CitationMeta, structured authors) returned by the DOI/PubMed lookups, so
// these three functions live alongside the legacy formatter.

function initial(given: string | undefined): string {
  if (!given) return '';
  const first = given.trim()[0];
  return first ? `${first.toUpperCase()}.` : '';
}

function apaAuthorList(authors: CitationAuthor[]): string {
  const parts = authors.map((a) => {
    const i = initial(a.given);
    return i ? `${a.family}, ${i}` : a.family;
  });
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]}, & ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, & ${parts.at(-1) ?? ''}`;
}

function mlaAuthorList(authors: CitationAuthor[]): string {
  if (authors.length === 0) return '';
  const head = authors[0];
  if (!head) return '';
  const headStr = head.given ? `${head.family}, ${head.given}` : head.family;
  if (authors.length === 1) return headStr;
  if (authors.length === 2) {
    const b = authors[1];
    if (!b) return headStr;
    return `${headStr}, and ${b.given ?? ''} ${b.family}`.replace(/\s+/g, ' ').trim();
  }
  return `${headStr}, et al.`;
}

function chicagoAuthorList(authors: CitationAuthor[]): string {
  // Chicago author-date matches MLA author-list shape for ≤3 authors.
  return mlaAuthorList(authors);
}

export function formatApa(m: CitationMeta): string {
  const out: string[] = [];
  const authors = apaAuthorList(m.authors);
  if (authors) out.push(authors.endsWith('.') ? authors : `${authors}.`);
  if (m.year !== undefined) out.push(`(${m.year}).`);
  out.push(`${m.title}.`);
  if (m.journal) {
    let issueStr = m.journal;
    if (m.volume) {
      issueStr += `, ${m.volume}`;
      if (m.issue) issueStr += `(${m.issue})`;
    }
    if (m.pages) issueStr += `, ${m.pages}`;
    out.push(`${issueStr}.`);
  }
  if (m.url) out.push(m.url);
  return out.join(' ').trim();
}

export function formatMla(m: CitationMeta): string {
  const out: string[] = [];
  const authors = mlaAuthorList(m.authors);
  if (authors) out.push(`${authors}.`);
  out.push(`"${m.title}."`);
  if (m.journal) {
    const journalParts: string[] = [m.journal];
    if (m.volume) journalParts.push(`vol. ${m.volume}`);
    if (m.issue) journalParts.push(`no. ${m.issue}`);
    if (m.year !== undefined) journalParts.push(`${m.year}`);
    if (m.pages) journalParts.push(`pp. ${m.pages}`);
    out.push(`${journalParts.join(', ')}.`);
  } else if (m.year !== undefined) {
    out.push(`${m.year}.`);
  }
  return out.join(' ').trim();
}

export function formatChicago(m: CitationMeta): string {
  const out: string[] = [];
  const authors = chicagoAuthorList(m.authors);
  if (authors) out.push(`${authors}.`);
  if (m.year !== undefined) out.push(`${m.year}.`);
  out.push(`"${m.title}."`);
  if (m.journal) {
    let issueStr = m.journal;
    if (m.volume) {
      issueStr += ` ${m.volume}`;
      if (m.issue) issueStr += ` (${m.issue})`;
    }
    if (m.pages) issueStr += `: ${m.pages}`;
    out.push(`${issueStr}.`);
  }
  if (m.url) out.push(`${m.url}.`);
  return out.join(' ').trim();
}
