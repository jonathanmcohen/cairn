import { describe, expect, it, vi } from 'vitest';
import { exchangeCode } from '@/lib/chat/oauth-exchange';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('chat oauth code exchange', () => {
  it('parses a Slack oauth.v2.access success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: true,
        access_token: 'xoxb-tok',
        team: { id: 'T1' },
        scope: 'chat:write,commands',
      }),
    );
    const out = await exchangeCode('slack', {
      code: 'C',
      clientId: 'CID',
      clientSecret: 'SEC',
      redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/slack/callback',
      fetchImpl,
    });
    expect(out).toEqual({
      botToken: 'xoxb-tok',
      externalTeamId: 'T1',
      scopes: ['chat:write', 'commands'],
    });
  });

  it('throws on a Slack { ok: false } response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, error: 'invalid_code' }));
    await expect(
      exchangeCode('slack', {
        code: 'C',
        clientId: 'CID',
        clientSecret: 'SEC',
        redirectUri: 'https://c.example.com/cb',
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid_code/);
  });

  it('parses a Discord token grant with guild', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: 'disc-tok',
        guild: { id: 'G1' },
        scope: 'bot applications.commands',
      }),
    );
    const out = await exchangeCode('discord', {
      code: 'C',
      clientId: 'DID',
      clientSecret: 'SEC',
      redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/discord/callback',
      fetchImpl,
    });
    expect(out).toEqual({
      botToken: 'disc-tok',
      externalTeamId: 'G1',
      scopes: ['bot', 'applications.commands'],
    });
  });
});
