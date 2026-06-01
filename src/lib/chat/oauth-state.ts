/**
 * v0.9.8 G6 (audit F) — CSRF state for chat OAuth installs.
 *
 * A short-TTL HS256 JWT (default 600s) signed with AUTH_SECRET, mirroring
 * src/lib/sso/oidc-state.ts. The install-start route mints it; the callback
 * verifies it (platform + signature + expiry) before exchanging the code.
 */

import { signStateJwt, verifyStateJwt } from '@/lib/sso/state-jwt';

export type ChatOauthPlatform = 'slack' | 'discord';

export type ChatOauthStatePayload = {
  workspaceId: string;
  platform: ChatOauthPlatform;
  nonce: string;
};

export async function signOauthState(
  input: ChatOauthStatePayload & { ttlSeconds?: number },
): Promise<string> {
  return signStateJwt(
    { workspaceId: input.workspaceId, platform: input.platform, nonce: input.nonce },
    { ttlSeconds: input.ttlSeconds ?? 600 },
  );
}

export async function verifyOauthState(
  value: string,
  expectedPlatform: ChatOauthPlatform,
): Promise<ChatOauthStatePayload> {
  const payload = await verifyStateJwt(value);
  const workspaceId = payload.workspaceId;
  const platform = payload.platform;
  const nonce = payload.nonce;
  if (
    typeof workspaceId !== 'string' ||
    (platform !== 'slack' && platform !== 'discord') ||
    typeof nonce !== 'string'
  ) {
    throw new Error('invalid oauth state payload shape');
  }
  if (platform !== expectedPlatform) {
    throw new Error('platform mismatch');
  }
  return { workspaceId, platform, nonce };
}
