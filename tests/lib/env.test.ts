import { parseEnv } from '@/lib/env';
import { describe, expect, it } from 'vitest';

describe('parseEnv', () => {
  it('accepts a fully-formed environment', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      AUTH_SECRET: 'x'.repeat(32),
      NEXTAUTH_URL: 'http://localhost:3000',
    });
    expect(env.DATABASE_URL).toBe('postgres://u:p@h:5432/d');
    expect(env.CAIRN_MAX_UPLOAD_MB).toBe(25);
    expect(env.CAIRN_TRASH_RETENTION_DAYS).toBe(30);
    expect(env.CAIRN_LOG_LEVEL).toBe('info');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      parseEnv({ AUTH_SECRET: 'x'.repeat(32), NEXTAUTH_URL: 'http://localhost:3000' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an AUTH_SECRET shorter than 32 chars', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgres://u:p@h:5432/d',
        AUTH_SECRET: 'short',
        NEXTAUTH_URL: 'http://localhost:3000',
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it('coerces numeric strings', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      AUTH_SECRET: 'x'.repeat(32),
      NEXTAUTH_URL: 'http://localhost:3000',
      CAIRN_MAX_UPLOAD_MB: '50',
    });
    expect(env.CAIRN_MAX_UPLOAD_MB).toBe(50);
  });
});
