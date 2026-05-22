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

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
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

describe('GET /api/unfurl', () => {
  it('401 when unauthenticated', async () => {
    (auth as unknown as { __setCtx: (c: unknown) => void }).__setCtx(null);
    const res = await call('https://example.com');
    expect(res.status).toBe(401);
  });

  it('400 for a missing/invalid url', async () => {
    const res = await GET(new Request('https://app.test/api/unfurl'));
    expect(res.status).toBe(400);
  });

  it('blocks an internal/loopback host (SSRF) without fetching', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await call('http://127.0.0.1/admin');
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks the cloud metadata IP', async () => {
    const res = await call('http://169.254.169.254/latest/meta-data/');
    expect(res.status).toBe(400);
  });

  it('parses OG tags from a public page', async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(
        '<head><meta property="og:title" content="Hello"/><meta property="og:description" content="World"/></head>',
      ),
    ) as unknown as typeof fetch;
    const res = await call('https://example.com/post');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; description: string; favicon: string };
    expect(body.title).toBe('Hello');
    expect(body.description).toBe('World');
    expect(body.favicon).toBe('https://example.com/favicon.ico');
  });

  it('422 when the response is not HTML', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
    const res = await call('https://example.com/api.json');
    expect(res.status).toBe(422);
  });
});
