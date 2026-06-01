/**
 * v0.9.8 G6 (audit F) — Slack + Discord OAuth provider config.
 *
 * Slack: oauth.v2.access (comma-delimited bot scopes). Discord: bot
 * authorization-code grant (space-delimited scopes + bot permissions integer).
 * Redirect URIs are always derived from publicOrigin() and SSRF-gated so we
 * never hand an internal callback URL to an external IdP.
 */

import type { ChatOauthPlatform } from '@/lib/chat/oauth-state';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeDelimiter: string;
  // Discord-only: bot permissions bitfield (View Channels + Send Messages + Read History).
  permissions?: string;
};

export const PROVIDERS: Record<ChatOauthPlatform, ProviderConfig> = {
  slack: {
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read', 'channels:history', 'commands'],
    scopeDelimiter: ',',
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: ['bot', 'applications.commands'],
    scopeDelimiter: ' ',
    permissions: '68608', // View Channel (1024) + Send Messages (2048) + Read History (65536)
  },
};

export async function oauthRedirectUri(
  origin: string,
  platform: ChatOauthPlatform,
): Promise<string> {
  const uri = `${origin.replace(/\/$/, '')}/api/admin/chat-bridge/oauth/${platform}/callback`;
  // Re-validate the origin is public (defends against a spoofed PUBLIC_URL / host header).
  await assertPublicUrl(uri);
  return uri;
}

export function buildAuthorizeUrl(
  platform: ChatOauthPlatform,
  input: { clientId: string; redirectUri: string; state: string },
): string {
  const cfg = PROVIDERS[platform];
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', cfg.scopes.join(cfg.scopeDelimiter));
  url.searchParams.set('response_type', 'code');
  if (cfg.permissions) url.searchParams.set('permissions', cfg.permissions);
  return url.toString();
}
