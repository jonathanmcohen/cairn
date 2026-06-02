import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => {
  let session: { user: { id: string } } | null = { user: { id: 'u1' } };
  return {
    auth: vi.fn(async () => session),
    __set: (s: typeof session) => {
      session = s;
    },
  };
});

vi.mock('@/lib/citations/lookup', () => ({
  lookupDoi: vi.fn(),
  lookupPubmed: vi.fn(),
}));

const DOI_META = {
  source: 'doi' as const,
  authors: [{ family: 'Doe', given: 'J' }],
  title: 'T',
  year: 2024,
};
const PUBMED_META = {
  source: 'pubmed' as const,
  authors: [{ family: 'Doe', given: 'J' }],
  title: 'P',
  year: 2024,
  pmid: '99',
};

beforeEach(async () => {
  const cfg = (await import('@/lib/auth/config')) as unknown as {
    __set: (s: { user: { id: string } } | null) => void;
  };
  cfg.__set({ user: { id: 'u1' } });
  const lookup = (await import('@/lib/citations/lookup')) as unknown as {
    lookupDoi: ReturnType<typeof vi.fn>;
    lookupPubmed: ReturnType<typeof vi.fn>;
  };
  lookup.lookupDoi.mockImplementation(async () => DOI_META);
  lookup.lookupPubmed.mockImplementation(async () => PUBMED_META);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/citations/lookup', () => {
  it('returns {meta, formatted} for doi=', async () => {
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?doi=10.1/abc');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { source: string };
      formatted: { apa: string; mla: string; chicago: string };
    };
    expect(body.meta.source).toBe('doi');
    expect(body.formatted.apa).toContain('Doe');
    expect(body.formatted.mla).toContain('"T."');
    expect(body.formatted.chicago).toContain('2024');
  });

  it('returns {meta, formatted} for pubmed=', async () => {
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?pubmed=99');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { pmid?: string } };
    expect(body.meta.pmid).toBe('99');
  });

  it('400s when neither doi nor pubmed is supplied', async () => {
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('400s when both doi and pubmed are supplied', async () => {
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?doi=10.1/a&pubmed=99');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('401s when unauthenticated', async () => {
    const cfg = (await import('@/lib/auth/config')) as unknown as {
      __set: (s: null) => void;
    };
    cfg.__set(null);
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?doi=10.1/a');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('happy path: paste DOI → 200 with meta + APA/MLA/Chicago formatted (finding L)', async () => {
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?doi=10.1234/abc');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { source: string; title: string; year?: number };
      formatted: { apa: string; mla: string; chicago: string };
    };
    expect(body.meta.source).toBe('doi');
    expect(body.meta.title).toBe('T');
    // All three styles are non-empty so the dialog preview + Insert work.
    expect(body.formatted.apa.length).toBeGreaterThan(0);
    expect(body.formatted.mla.length).toBeGreaterThan(0);
    expect(body.formatted.chicago.length).toBeGreaterThan(0);
  });

  it('error path: bad DOI → upstream throw → generic 502 (finding L)', async () => {
    const lookup = (await import('@/lib/citations/lookup')) as unknown as {
      lookupDoi: ReturnType<typeof vi.fn>;
    };
    lookup.lookupDoi.mockImplementationOnce(async () => {
      throw new Error('crossref: 404 Not Found');
    });
    const { GET } = await import('@/app/api/citations/lookup/route');
    const req = new Request('http://x/api/citations/lookup?doi=10.9999/does-not-exist');
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('lookup failed');
    // The generic message must NOT leak the upstream error detail.
    expect(JSON.stringify(body)).not.toContain('crossref');
    expect(JSON.stringify(body)).not.toContain('404');
  });
});
