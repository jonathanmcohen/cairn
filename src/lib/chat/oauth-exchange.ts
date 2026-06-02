/**
 * v0.9.8 G6 (audit F) — exchange an OAuth authorization code for a bot token.
 *
 * Pure + fetch-injected (tests pass a stub). Returns the bot token plaintext,
 * the external team/guild id, and granted scopes. The caller seals the token
 * (oauth-token.ts) before persisting and never logs it.
 */

import { PROVIDERS } from '@/lib/chat/oauth-providers';
import type { ChatOauthPlatform } from '@/lib/chat/oauth-state';

type FetchLike = typeof fetch;

export type ExchangeInput = {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
};

export type ExchangeResult = {
  botToken: string;
  externalTeamId: string;
  scopes: string[];
};

function parseScopes(raw: unknown, delimiter: string): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function exchangeCode(
  platform: ChatOauthPlatform,
  input: ExchangeInput,
): Promise<ExchangeResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const cfg = PROVIDERS[platform];
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  });

  const res = await doFetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (platform === 'slack') {
    if (data.ok !== true) {
      throw new Error(`Slack token exchange failed: ${String(data.error ?? res.status)}`);
    }
    const team = data.team as { id?: string } | undefined;
    return {
      botToken: String(data.access_token ?? ''),
      externalTeamId: String(team?.id ?? ''),
      scopes: parseScopes(data.scope, ','),
    };
  }

  // Discord
  if (!res.ok || typeof data.access_token !== 'string') {
    throw new Error(`Discord token exchange failed: ${String(data.error ?? res.status)}`);
  }
  const guild = data.guild as { id?: string } | undefined;
  return {
    botToken: String(data.access_token),
    externalTeamId: String(guild?.id ?? ''),
    scopes: parseScopes(data.scope, ' '),
  };
}
