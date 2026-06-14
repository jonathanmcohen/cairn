// v0.10.3 A11Y-0 — the public REST API (/api/v1/*) must be reachable THROUGH
// the proxy by headless bearer clients. Before the fix, /api/v1 was missing from
// proxy.ts PUBLIC_PATHS, so the cookie gate 307-redirected every cookieless call
// to /login (HTML) — the documented API was unusable for scripts/CI/the a11y
// seed exporter. The existing tests/api/v1-*.test.ts import the handler directly
// and bypass the proxy, so they never caught this. This spec drives the REAL
// booted server through the proxy.
import { expect, test } from '../a11y/fixtures';

test.describe('A11Y-0 — /api/v1 is a headless bearer surface, not cookie-gated', () => {
  test('GET /api/v1/pages with NO session + NO key → 401 JSON (not 307 → /login)', async ({
    page,
  }) => {
    // No signIn: a cookieless request, exactly like a script with a bad/absent key.
    const res = await page.request.get('/api/v1/pages', { maxRedirects: 0 });
    // The route's own boundary (withApiKey) answers 401; the proxy must NOT
    // bounce it to /login (which is the 307 this guards against).
    expect(res.status(), 'proxy must not redirect the bearer API to /login').toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('unauthorized');
  });

  test('GET /api/v1/pages with a bogus bearer → 401 JSON through the proxy', async ({ page }) => {
    const res = await page.request.get('/api/v1/pages', {
      headers: { authorization: 'Bearer cairn_sk_0000000000000000000000000000000000000000000000000000000000000000' },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(401);
    expect(res.headers()['content-type'] ?? '').toContain('application/json');
  });
});
