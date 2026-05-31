/**
 * v0.9.6 G8 — login-options route. Mocks the lib helper so this stays a thin
 * HTTP/cookie test (no DB) — the DB behavior is covered in webauthn-login.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/webauthn', () => ({
  WebAuthnNotConfiguredError: class extends Error {},
  beginLoginAssertion: vi.fn(),
}));

import { POST } from '@/app/api/webauthn/login-options/route';
import { beginLoginAssertion } from '@/lib/auth/webauthn';

beforeEach(() => {
  vi.mocked(beginLoginAssertion).mockReset();
});

function req(body: unknown): Request {
  return new Request('http://local/api/webauthn/login-options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/webauthn/login-options', () => {
  it('returns options + sets the challenge cookie when the user has passkeys', async () => {
    vi.mocked(beginLoginAssertion).mockResolvedValue({
      options: { challenge: 'ch', rpId: 'rp', allowCredentials: [] } as never,
      expectedChallenge: 'ch',
    });
    const res = await POST(req({ email: 'u@e.com' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { options?: unknown };
    expect(json.options).toBeDefined();
    expect(res.headers.get('set-cookie')).toContain('cairn_wac_l=ch');
  });

  it('returns 204 with no cookie when the user has no passkeys', async () => {
    vi.mocked(beginLoginAssertion).mockResolvedValue(null);
    const res = await POST(req({ email: 'nobody@e.com' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('cairn_wac_l');
  });

  it('rejects a malformed body with 400', async () => {
    const res = await POST(req({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });
});
