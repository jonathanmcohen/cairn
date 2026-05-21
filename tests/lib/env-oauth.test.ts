import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';

const base = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  AUTH_SECRET: 'x'.repeat(32),
  NEXTAUTH_URL: 'http://localhost:3000',
};

describe('OAuth env vars', () => {
  it('are optional — base env parses with none set', () => {
    const env = parseEnv(base);
    expect(env.AUTH_GOOGLE_ID).toBeUndefined();
    expect(env.AUTH_GITHUB_ID).toBeUndefined();
  });

  it('parse when present', () => {
    const env = parseEnv({
      ...base,
      AUTH_GOOGLE_ID: 'gid',
      AUTH_GOOGLE_SECRET: 'gsecret',
      AUTH_GITHUB_ID: 'hid',
      AUTH_GITHUB_SECRET: 'hsecret',
    });
    expect(env.AUTH_GOOGLE_ID).toBe('gid');
    expect(env.AUTH_GOOGLE_SECRET).toBe('gsecret');
    expect(env.AUTH_GITHUB_ID).toBe('hid');
    expect(env.AUTH_GITHUB_SECRET).toBe('hsecret');
  });
});
