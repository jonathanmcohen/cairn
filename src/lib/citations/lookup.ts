/**
 * v0.9.0 G3 P21 — DOI / PubMed lookup with hard rate-limit + size + timeout caps.
 *
 * Server-side helpers (called only from the API route). Each source has a 1-RPS
 * in-memory throttle keyed by source name; this is single-instance only (the
 * v0.6 docs already document the in-memory rate-limit ceiling), since Cairn
 * targets a single Next.js container.
 *
 * Hard bounds (per call):
 *   - 5-second AbortController timeout
 *   - 256 KB response cap (declared via `content-length`, then re-checked on
 *     the fully-buffered text — covers chunked responses that omit the header)
 *
 * On any error the caller (the route handler) should map to a generic 502 and
 * log the raw `Error.message` server-side; never expose the upstream payload.
 */

import type { CitationAuthor, CitationMeta } from './types';

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const RATE_LIMIT_MS = 1000;

const lastCallAt: Map<'doi' | 'pubmed', number> = new Map();

export function __resetRateLimitForTests(): void {
  lastCallAt.clear();
}

async function rateLimit(source: 'doi' | 'pubmed'): Promise<void> {
  const last = lastCallAt.get(source) ?? 0;
  const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt.set(source, Date.now());
}

async function fetchJsonBounded(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new Error('citation fetch timeout');
    }
    throw err;
  }
  clearTimeout(timer);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) {
    throw new Error(`oversize response (>${MAX_BYTES} bytes)`);
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) {
    throw new Error(`oversize response (>${MAX_BYTES} bytes)`);
  }
  return JSON.parse(text);
}

type CrossrefAuthor = { given?: string; family?: string };
type CrossrefMessage = {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  URL?: string;
};

function normalizeCrossref(raw: { message?: CrossrefMessage }): CitationMeta {
  const m = raw.message ?? {};
  const year = m.issued?.['date-parts']?.[0]?.[0];
  const authors: CitationAuthor[] = (m.author ?? [])
    .filter((a): a is { family: string; given?: string } => typeof a.family === 'string')
    .map((a) => ({ family: a.family, given: a.given }));
  return {
    source: 'doi',
    authors,
    title: m.title?.[0] ?? '',
    year: typeof year === 'number' ? year : undefined,
    journal: m['container-title']?.[0],
    volume: m.volume,
    issue: m.issue,
    pages: m.page,
    doi: m.DOI,
    url: m.URL,
  };
}

type PubmedAuthor = { name?: string };
type PubmedSummary = {
  uid?: string;
  title?: string;
  authors?: PubmedAuthor[];
  pubdate?: string;
  fulljournalname?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleids?: { idtype: string; value: string }[];
};

function splitPubmedName(name: string): CitationAuthor {
  // "Doe J" → family "Doe", given "J". Handle multi-word families: "van der Berg JA".
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] ?? '' };
  const given = parts.at(-1) ?? '';
  const family = parts.slice(0, -1).join(' ');
  return { family, given };
}

function normalizePubmed(
  raw: { result?: Record<string, PubmedSummary | string[]> },
  pmid: string,
): CitationMeta {
  const result = raw.result ?? {};
  const entry = result[pmid];
  if (!entry || Array.isArray(entry)) {
    throw new Error(`pubmed: no record for ${pmid}`);
  }
  const yearMatch = entry.pubdate?.match(/^(\d{4})/);
  const doi = entry.articleids?.find((id) => id.idtype === 'doi')?.value;
  const authors: CitationAuthor[] = (entry.authors ?? [])
    .map((a) => (a.name ? splitPubmedName(a.name) : null))
    .filter((a): a is CitationAuthor => a !== null);
  return {
    source: 'pubmed',
    authors,
    title: entry.title ?? '',
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    journal: entry.fulljournalname,
    volume: entry.volume,
    issue: entry.issue,
    pages: entry.pages,
    doi,
    pmid,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
}

export async function lookupDoi(doi: string): Promise<CitationMeta> {
  await rateLimit('doi');
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const raw = (await fetchJsonBounded(url)) as { message?: CrossrefMessage };
  return normalizeCrossref(raw);
}

export async function lookupPubmed(pmid: string): Promise<CitationMeta> {
  await rateLimit('pubmed');
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;
  const raw = (await fetchJsonBounded(url)) as {
    result?: Record<string, PubmedSummary | string[]>;
  };
  return normalizePubmed(raw, pmid);
}
