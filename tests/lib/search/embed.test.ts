import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tests directly drive the module — no DB. The factory + remote-mock cases
// always run. The local-model shape test downloads ~80MB on first run and is
// gated by CAIRN_TEST_LOCAL_EMBED=1 (skipped by default in CI).

describe('embedding provider factory', () => {
  beforeEach(() => {
    delete process.env.CAIRN_EMBEDDING_URL;
    delete process.env.CAIRN_EMBEDDING_MODEL;
    delete process.env.CAIRN_EMBEDDING_API_KEY;
    // Reset the singleton — the factory caches per process.
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Local when CAIRN_EMBEDDING_URL is unset', async () => {
    const { getEmbeddingProvider } = await import('@/lib/search/embed');
    const p = getEmbeddingProvider();
    expect(p.kind).toBe('local');
    expect(p.dim).toBe(384);
    expect(p.model).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('returns Remote when CAIRN_EMBEDDING_URL is set', async () => {
    process.env.CAIRN_EMBEDDING_URL = 'http://ollama:11434/v1/embeddings';
    process.env.CAIRN_EMBEDDING_MODEL = 'nomic-embed-text';
    process.env.CAIRN_EMBEDDING_API_KEY = 'sk-abc';
    const { getEmbeddingProvider } = await import('@/lib/search/embed');
    const p = getEmbeddingProvider();
    expect(p.kind).toBe('remote');
    expect(p.model).toBe('nomic-embed-text');
  });

  it('caches a singleton across calls within one process', async () => {
    const { getEmbeddingProvider } = await import('@/lib/search/embed');
    const a = getEmbeddingProvider();
    const b = getEmbeddingProvider();
    expect(a).toBe(b);
  });
});

// Gated behind CAIRN_TEST_LOCAL_EMBED=1 — the Xenova model is ~80MB and the
// download dominates CI wall time. Run locally to validate the ORT wiring.
const itLocal = process.env.CAIRN_TEST_LOCAL_EMBED === '1' ? it : it.skip;

describe('LocalEmbeddingProvider.embed', () => {
  itLocal(
    'returns a Float32Array of length 384 for non-empty text',
    async () => {
      delete process.env.CAIRN_EMBEDDING_URL;
      vi.resetModules();
      const { getEmbeddingProvider } = await import('@/lib/search/embed');
      const p = getEmbeddingProvider();
      const out = await p.embed('hello world');
      expect(out).toBeInstanceOf(Float32Array);
      expect(out.length).toBe(384);
      // sanity: not all-zero (the model returned something real)
      expect(Array.from(out).some((v) => v !== 0)).toBe(true);
    },
    120_000,
  );

  itLocal(
    'returns the same shape for empty input (zero vector or normalized fallback)',
    async () => {
      delete process.env.CAIRN_EMBEDDING_URL;
      vi.resetModules();
      const { getEmbeddingProvider } = await import('@/lib/search/embed');
      const p = getEmbeddingProvider();
      const out = await p.embed('');
      expect(out.length).toBe(384);
    },
    120_000,
  );
});

describe('RemoteEmbeddingProvider.embed', () => {
  beforeEach(() => {
    delete process.env.CAIRN_EMBEDDING_URL;
    delete process.env.CAIRN_EMBEDDING_MODEL;
    delete process.env.CAIRN_EMBEDDING_API_KEY;
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a Bearer header and parses the OpenAI-shape response', async () => {
    process.env.CAIRN_EMBEDDING_URL = 'http://stub.local/v1/embeddings';
    process.env.CAIRN_EMBEDDING_MODEL = 'nomic-embed-text';
    process.env.CAIRN_EMBEDDING_API_KEY = 'sk-test-XYZ';
    vi.resetModules();

    const fakeVec = Array.from({ length: 384 }, (_, i) => (i % 7) * 0.01);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: fakeVec }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { getEmbeddingProvider } = await import('@/lib/search/embed');
    const p = getEmbeddingProvider();
    const out = await p.embed('hello');

    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(384);
    expect(out[0]).toBeCloseTo(fakeVec[0] ?? 0, 5);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(url).toBe('http://stub.local/v1/embeddings');
    expect((init as RequestInit).method).toBe('POST');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test-XYZ');
    expect(headers.get('content-type')).toMatch(/^application\/json/);
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ model: 'nomic-embed-text', input: 'hello' });
  });

  it('throws when the remote returns non-OK', async () => {
    process.env.CAIRN_EMBEDDING_URL = 'http://stub.local/v1/embeddings';
    vi.resetModules();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream down', { status: 502 }));
    const { getEmbeddingProvider } = await import('@/lib/search/embed');
    const p = getEmbeddingProvider();
    await expect(p.embed('hello')).rejects.toThrow(/502|upstream/i);
  });

  it('omits the Authorization header when CAIRN_EMBEDDING_API_KEY is unset', async () => {
    process.env.CAIRN_EMBEDDING_URL = 'http://stub.local/v1/embeddings';
    delete process.env.CAIRN_EMBEDDING_API_KEY;
    vi.resetModules();
    const fakeVec = Array.from({ length: 384 }, () => 0.1);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: fakeVec }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { getEmbeddingProvider } = await import('@/lib/search/embed');
    const p = getEmbeddingProvider();
    await p.embed('hi');
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const headers = new Headers((call[1] as RequestInit).headers);
    expect(headers.get('authorization')).toBeNull();
  });
});
