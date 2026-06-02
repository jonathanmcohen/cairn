import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, oauthRedirectUri, PROVIDERS } from '@/lib/chat/oauth-providers';

describe('chat oauth providers', () => {
  it('builds a public, SSRF-safe redirect URI from a public origin', async () => {
    // Use a literal public IP so assertPublicUrl needs no DNS (the sandbox has
    // no outbound resolver); this exercises the same build + SSRF-gate path.
    const uri = await oauthRedirectUri('https://1.1.1.1', 'slack');
    expect(uri).toBe('https://1.1.1.1/api/admin/chat-bridge/oauth/slack/callback');
  });

  it('rejects a private/loopback origin', async () => {
    await expect(oauthRedirectUri('http://127.0.0.1:3000', 'slack')).rejects.toThrow(/Refusing/);
  });

  it('builds a Slack authorize URL with scopes, client id, redirect and state', () => {
    const url = new URL(
      buildAuthorizeUrl('slack', {
        clientId: 'CID',
        redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/slack/callback',
        state: 'STATE',
      }),
    );
    expect(url.origin + url.pathname).toBe(PROVIDERS.slack.authorizeUrl);
    expect(url.searchParams.get('client_id')).toBe('CID');
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('scope')).toBe(PROVIDERS.slack.scopes.join(','));
    expect(url.searchParams.get('redirect_uri')).toContain('/slack/callback');
  });

  it('builds a Discord authorize URL (space-delimited scopes + permissions)', () => {
    const url = new URL(
      buildAuthorizeUrl('discord', {
        clientId: 'DID',
        redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/discord/callback',
        state: 'ST',
      }),
    );
    expect(url.searchParams.get('scope')).toBe(PROVIDERS.discord.scopes.join(' '));
    expect(url.searchParams.get('client_id')).toBe('DID');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});
