import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock googleapis BEFORE importing the SUT — vitest hoists vi.mock calls.
vi.mock('googleapis', () => {
  class OAuth2 {
    credentials: { refresh_token?: string } = {};
    setCredentials = vi.fn((creds: { refresh_token?: string }) => {
      this.credentials = { ...this.credentials, ...creds };
    });
    generateAuthUrl = vi.fn().mockReturnValue('https://example.com/auth');
    getToken = vi.fn().mockResolvedValue({
      tokens: {
        refresh_token: 'stub-refresh',
        access_token: 'stub-access',
        expiry_date: 1234567890,
      },
    });
  }
  return {
    google: {
      auth: { OAuth2 },
    },
  };
});

import {
  buildAuthUrl,
  buildOAuthClient,
  exchangeCodeForTokens,
  loadAuthorizedClient,
} from '@/lib/connectors/sheets/auth';

describe('sheets/auth', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://x');
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-thirty-two-chars-min-aaaaaa');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
    vi.stubEnv('CAIRN_GOOGLE_OAUTH_CLIENT_ID', 'client-id');
    vi.stubEnv('CAIRN_GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('buildOAuthClient throws when env missing', async () => {
    vi.stubEnv('CAIRN_GOOGLE_OAUTH_CLIENT_ID', '');
    vi.stubEnv('CAIRN_GOOGLE_OAUTH_CLIENT_SECRET', '');
    // env() caches; reset the module cache so the stub takes effect.
    vi.resetModules();
    const { buildOAuthClient: fresh } = await import('@/lib/connectors/sheets/auth');
    expect(() => fresh('http://localhost/cb')).toThrow(/Google OAuth client not configured/);
  });

  it('buildOAuthClient returns an OAuth2 client when env is set', () => {
    const client = buildOAuthClient('http://localhost/cb');
    expect(client).toBeDefined();
  });

  it('buildAuthUrl produces an auth URL string', () => {
    const url = buildAuthUrl('http://localhost/cb', 'state-blob');
    expect(url).toBe('https://example.com/auth');
  });

  it('exchangeCodeForTokens returns tokens including the refresh token', async () => {
    const tokens = await exchangeCodeForTokens('code', 'http://localhost/cb');
    expect(tokens.refresh_token).toBe('stub-refresh');
    expect(tokens.access_token).toBe('stub-access');
    expect(tokens.expiry_date).toBe(1234567890);
  });

  it('loadAuthorizedClient applies the refresh token via setCredentials', () => {
    const client = loadAuthorizedClient({ refresh_token: 'plain-token' });
    expect(client).toBeDefined();
    // The mock OAuth2 returns a stub with a vi.fn `setCredentials`; assert it
    // was called with our token.
    // biome-ignore lint/suspicious/noExplicitAny: mock object access
    expect((client as any).setCredentials).toHaveBeenCalledWith({ refresh_token: 'plain-token' });
  });
});
