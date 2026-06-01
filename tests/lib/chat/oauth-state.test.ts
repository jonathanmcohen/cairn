import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signOauthState, verifyOauthState } from '@/lib/chat/oauth-state';

describe('chat oauth CSRF state', () => {
  const prev = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = 'a'.repeat(40);
  });
  afterEach(() => {
    process.env.AUTH_SECRET = prev;
  });

  it('round-trips a signed state for the matching platform', async () => {
    const token = await signOauthState({
      workspaceId: 'ws-1',
      platform: 'slack',
      nonce: 'n1',
    });
    const payload = await verifyOauthState(token, 'slack');
    expect(payload.workspaceId).toBe('ws-1');
    expect(payload.platform).toBe('slack');
    expect(payload.nonce).toBe('n1');
  });

  it('rejects a platform mismatch', async () => {
    const token = await signOauthState({ workspaceId: 'ws-1', platform: 'slack', nonce: 'n' });
    await expect(verifyOauthState(token, 'discord')).rejects.toThrow(/platform mismatch/);
  });

  it('rejects an expired state', async () => {
    const token = await signOauthState({
      workspaceId: 'ws-1',
      platform: 'slack',
      nonce: 'n',
      ttlSeconds: -1,
    });
    await expect(verifyOauthState(token, 'slack')).rejects.toThrow();
  });
});
