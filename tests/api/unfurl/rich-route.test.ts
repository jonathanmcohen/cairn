import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => {
  let ctx: unknown = { userId: 'u1', workspaceId: 'w1', role: 'editor' };
  return {
    getAuthContext: vi.fn(async () => ctx),
    __setCtx: (c: unknown) => {
      ctx = c;
    },
  };
});

import { GET } from '@/app/api/unfurl/route';
import * as auth from '@/lib/auth/require-role';

const realFetch = globalThis.fetch;

function htmlBody(html: string, ctype = 'text/html'): Response {
  return new Response(html, { status: 200, headers: { 'content-type': ctype } });
}

function imageBody(size: number, ctype = 'image/jpeg'): Response {
  return new Response(new Uint8Array(size), {
    status: 200,
    headers: { 'content-type': ctype, 'content-length': String(size) },
  });
}

function call(url: string): Promise<Response> {
  return GET(new Request(`https://app.test/api/unfurl?url=${encodeURIComponent(url)}`));
}

beforeEach(() => {
  (auth as unknown as { __setCtx: (c: unknown) => void }).__setCtx({
    userId: 'u1',
    workspaceId: 'w1',
    role: 'editor',
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('/api/unfurl — rich extract', () => {
  it('returns imageData when the og:image fits under 256KB', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.startsWith('https://example.com/article')) {
        return htmlBody(
          '<html><head><title>T</title><meta property="og:image" content="https://example.com/cover.jpg" /></head></html>',
        );
      }
      if (s === 'https://example.com/cover.jpg') return imageBody(1024);
      throw new Error(`unexpected fetch: ${s}`);
    }) as unknown as typeof fetch;

    const res = await call('https://example.com/article');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { imageData: string | null; image: string | null };
    expect(json.image).toBe('https://example.com/cover.jpg');
    expect(json.imageData?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('omits imageData (null) when the og:image exceeds 256KB', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.startsWith('https://example.com/article')) {
        return htmlBody(
          '<html><head><meta property="og:image" content="https://example.com/big.jpg" /></head></html>',
        );
      }
      if (s === 'https://example.com/big.jpg') return imageBody(300 * 1024);
      throw new Error(`unexpected fetch: ${s}`);
    }) as unknown as typeof fetch;

    const res = await call('https://example.com/article');
    const json = (await res.json()) as { imageData: string | null; image: string | null };
    expect(json.image).toBe('https://example.com/big.jpg');
    expect(json.imageData).toBeNull();
  });

  it('omits imageData when the SSRF guard refuses the og:image host', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.startsWith('https://example.com/article')) {
        // og:image points at an internal host — assertPublicUrl will throw.
        return htmlBody(
          '<html><head><meta property="og:image" content="http://10.0.0.1/internal.jpg" /></head></html>',
        );
      }
      throw new Error(`unexpected fetch: ${s}`);
    }) as unknown as typeof fetch;

    const res = await call('https://example.com/article');
    const json = (await res.json()) as { imageData: string | null; image: string | null };
    expect(json.image).toBe('http://10.0.0.1/internal.jpg'); // URL surfaces in the response
    expect(json.imageData).toBeNull(); // but the bytes do not — guard refused
  });
});
