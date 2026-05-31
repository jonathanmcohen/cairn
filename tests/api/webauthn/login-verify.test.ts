/**
 * v0.9.6 G8 — login-verify route. Mocks the lib helper + ticket signer so this
 * is a thin HTTP/cookie test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The challenge round-trips via the httpOnly `cairn_wac_l` cookie, read through
// next/headers `cookies()`. The global tests/setup.ts mock backs that with an
// in-memory store rather than the request header, so we drive the cookie value
// per-test through this mutable holder.
let challengeCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cairn_wac_l' && challengeCookie !== undefined
        ? { name, value: challengeCookie }
        : undefined,
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock('@/lib/auth/webauthn', () => ({
  WebAuthnNotConfiguredError: class extends Error {},
  finishLoginAssertion: vi.fn(),
}));
vi.mock('@/lib/auth/passkey-ticket', () => ({
  signLoginTicket: vi.fn(() => 'signed-ticket'),
}));
vi.mock('@/lib/env', () => ({ env: () => ({ AUTH_SECRET: 'k'.repeat(48) }) }));

import { POST } from '@/app/api/webauthn/login-verify/route';
import { finishLoginAssertion } from '@/lib/auth/webauthn';

beforeEach(() => {
  vi.mocked(finishLoginAssertion).mockReset();
  challengeCookie = undefined;
});

function req(body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  challengeCookie = cookie?.includes('cairn_wac_l=') ? cookie.split('cairn_wac_l=')[1] : undefined;
  return new Request('http://local/api/webauthn/login-verify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/webauthn/login-verify', () => {
  it('returns a ticket + clears the challenge cookie on success', async () => {
    vi.mocked(finishLoginAssertion).mockResolvedValue({
      ok: true,
      userId: 'user-123',
      credentialId: 'c',
    });
    const res = await POST(req({ response: { id: 'c' } }, 'cairn_wac_l=ch'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ticket?: string };
    expect(json.ticket).toBe('signed-ticket');
    expect(res.headers.get('set-cookie')).toContain('cairn_wac_l=;');
  });

  it('400 when the challenge cookie is missing', async () => {
    const res = await POST(req({ response: { id: 'c' } }));
    expect(res.status).toBe(400);
  });

  it('400 (generic) when the assertion fails', async () => {
    vi.mocked(finishLoginAssertion).mockResolvedValue({ ok: false, error: 'verification failed' });
    const res = await POST(req({ response: { id: 'c' } }, 'cairn_wac_l=ch'));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('login failed');
  });
});
