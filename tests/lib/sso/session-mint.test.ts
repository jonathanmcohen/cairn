import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mintSessionCookieForUser } from '@/lib/sso/session-mint';

beforeAll(() => {
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

vi.mock('next/headers', () => {
  const store = new Map<
    string,
    { name: string; value: string; options?: Record<string, unknown> }
  >();
  return {
    cookies: async () => ({
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        store.set(name, { name, value, options });
      },
      get: (name: string) => store.get(name),
      delete: (name: string) => store.delete(name),
    }),
    __store: store,
  };
});

describe('mintSessionCookieForUser', () => {
  it('writes a session cookie under the Auth.js cookie name with a signed JWT', async () => {
    await mintSessionCookieForUser({
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'alice@example.com',
      name: 'Alice',
    });
    const headers = (await import('next/headers')) as unknown as {
      __store: Map<string, { name: string; value: string; options?: Record<string, unknown> }>;
    };
    const cookie = headers.__store.get('next-auth.session-token');
    expect(cookie).toBeDefined();
    expect(typeof cookie!.value).toBe('string');
    expect(cookie!.value.split('.').length).toBeGreaterThanOrEqual(3); // JWE compact: 5 parts; JWS: 3
    expect(cookie!.options?.httpOnly).toBe(true);
    expect(cookie!.options?.path).toBe('/');
    expect(cookie!.options?.sameSite).toBe('lax');
  });
});
