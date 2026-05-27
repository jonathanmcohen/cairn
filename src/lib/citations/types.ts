/**
 * v0.9.0 G3 P21 — Normalized citation metadata.
 *
 * Both Crossref (DOI) and PubMed (eUtils) lookups produce this shape; the three
 * style formatters in `format.ts` consume it. Most fields are optional because
 * source data is frequently incomplete (PubMed entries often lack `journal-issue`
 * blocks, Crossref records often lack page ranges).
 */

export type CitationAuthor = {
  given?: string;
  family: string;
};

export type CitationMeta = {
  source: 'doi' | 'pubmed';
  authors: CitationAuthor[];
  title: string;
  year?: number;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  pmid?: string;
  url?: string;
};

export type FormattedCitation = {
  apa: string;
  mla: string;
  chicago: string;
};
