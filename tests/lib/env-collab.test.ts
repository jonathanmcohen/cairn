import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';

const base = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  AUTH_SECRET: 'x'.repeat(32),
  NEXTAUTH_URL: 'http://localhost:3000',
};

describe('COLLAB_URL env', () => {
  it('defaults to ws://localhost:1234 when unset', () => {
    const env = parseEnv(base);
    expect(env.COLLAB_URL).toBe('ws://localhost:1234');
  });

  it('passes through an explicit value', () => {
    const env = parseEnv({ ...base, COLLAB_URL: 'wss://cairn.example.com/collab' });
    expect(env.COLLAB_URL).toBe('wss://cairn.example.com/collab');
  });
});
