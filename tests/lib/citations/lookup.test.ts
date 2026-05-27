import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests, lookupDoi, lookupPubmed } from '@/lib/citations/lookup';

const CROSSREF_FIXTURE = {
  message: {
    DOI: '10.1234/widget.2024',
    title: ['A study of widgets'],
    author: [
      { given: 'Jane', family: 'Doe' },
      { given: 'Alex', family: 'Smith' },
    ],
    issued: { 'date-parts': [[2024]] },
    'container-title': ['Journal of Widgets'],
    volume: '12',
    issue: '3',
    page: '45-67',
    URL: 'https://doi.org/10.1234/widget.2024',
  },
};

const PUBMED_FIXTURE = {
  result: {
    '12345678': {
      uid: '12345678',
      title: 'PubMed article',
      authors: [{ name: 'Doe J' }, { name: 'Smith A' }],
      pubdate: '2024 Mar 1',
      fulljournalname: 'Journal of Pubs',
      volume: '5',
      issue: '2',
      pages: '10-20',
      articleids: [
        { idtype: 'pubmed', value: '12345678' },
        { idtype: 'doi', value: '10.9/x' },
      ],
    },
    uids: ['12345678'],
  },
};

function mockFetchJson(body: unknown) {
  const json = JSON.stringify(body);
  return vi.fn(async () => {
    return new Response(json, {
      headers: {
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(json).byteLength),
      },
      status: 200,
    });
  });
}

beforeEach(() => {
  __resetRateLimitForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lookupDoi', () => {
  it('normalizes a Crossref response', async () => {
    vi.stubGlobal('fetch', mockFetchJson(CROSSREF_FIXTURE));
    const meta = await lookupDoi('10.1234/widget.2024');
    expect(meta.source).toBe('doi');
    expect(meta.title).toBe('A study of widgets');
    expect(meta.authors).toEqual([
      { given: 'Jane', family: 'Doe' },
      { given: 'Alex', family: 'Smith' },
    ]);
    expect(meta.year).toBe(2024);
    expect(meta.journal).toBe('Journal of Widgets');
    expect(meta.volume).toBe('12');
    expect(meta.issue).toBe('3');
    expect(meta.pages).toBe('45-67');
    expect(meta.doi).toBe('10.1234/widget.2024');
  });

  it('rate-limits same-source calls to 1 RPS', async () => {
    vi.stubGlobal('fetch', mockFetchJson(CROSSREF_FIXTURE));
    const start = Date.now();
    await lookupDoi('10.1234/widget.2024');
    await lookupDoi('10.1234/widget.2024');
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  });

  it('aborts on oversize response', async () => {
    const big = 'x'.repeat(300_000);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(big, {
            headers: {
              'content-type': 'application/json',
              'content-length': '300000',
            },
          }),
      ),
    );
    await expect(lookupDoi('10.1234/big')).rejects.toThrow(/oversize|256/i);
  });

  it('times out at 5 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, opts?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            opts?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const p = lookupDoi('10.1234/slow');
    // Attach catch handler synchronously to prevent transient
    // unhandled-rejection warnings while fake timers advance.
    const settled = p.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await vi.advanceTimersByTimeAsync(5100);
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String((result.err as Error).message)).toMatch(/timeout|abort/i);
    }
    vi.useRealTimers();
  });
});

describe('lookupPubmed', () => {
  it('normalizes a PubMed eUtils response', async () => {
    vi.stubGlobal('fetch', mockFetchJson(PUBMED_FIXTURE));
    const meta = await lookupPubmed('12345678');
    expect(meta.source).toBe('pubmed');
    expect(meta.title).toBe('PubMed article');
    expect(meta.pmid).toBe('12345678');
    expect(meta.doi).toBe('10.9/x');
    expect(meta.year).toBe(2024);
    expect(meta.authors[0]).toEqual({ given: 'J', family: 'Doe' });
  });
});
