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
  lookupDoi: vi.fn(async () => ({
    source: 'doi' as const,
    authors: [{ family: 'Doe', given: 'J' }],
    title: 'T',
    year: 2024,
  })),
  lookupPubmed: vi.fn(async () => ({
    source: 'pubmed' as const,
    authors: [{ family: 'Doe', given: 'J' }],
    title: 'P',
    year: 2024,
    pmid: '99',
  })),
}));

beforeEach(async () => {
  const cfg = (await import('@/lib/auth/config')) as unknown as {
    __set: (s: { user: { id: string } } | null) => void;
  };
  cfg.__set({ user: { id: 'u1' } });
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
});
