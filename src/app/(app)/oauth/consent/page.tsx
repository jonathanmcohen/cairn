import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { OauthConsentScreen } from '@/components/dev-settings/oauth-consent-screen';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';
import { loadClientByClientId } from '@/lib/oauth/clients';
import { expandRequestedScopes, scopesForRole, validateScopes } from '@/lib/oauth/scopes';

/**
 * v0.9.16 Plan F — themed in-app OAuth consent screen (RSC). Reachable when a
 * signed-in user is sent here with validated authorize params. Re-validates the
 * client + redirect_uri (exact match) + PKCE before rendering, and intersects
 * the requested scopes with the user's workspace role. Allow/Cancel post back to
 * /api/oauth/authorize.
 *
 * The primary consent surface for headless MCP clients is the server-rendered
 * HTML in /api/oauth/authorize (GET); this page is the themed in-app equivalent.
 */
export default async function OauthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string): string => {
    const v = sp[k];
    return typeof v === 'string' ? v : '';
  };

  const ctx = await getAuthContext();
  if (!ctx?.userId) {
    const back = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
    ).toString();
    redirect(`/login?returnTo=${encodeURIComponent(`/oauth/consent?${back}`)}`);
  }
  if (!ctx.workspaceId || !ctx.role) {
    redirect('/');
  }

  const clientId = get('client_id');
  const redirectUri = get('redirect_uri');
  const codeChallenge = get('code_challenge');
  const method = get('code_challenge_method');

  const client = await loadClientByClientId(getDb(), clientId);
  if (
    !client ||
    !redirectUri ||
    !client.redirectUris.includes(redirectUri) ||
    !codeChallenge ||
    method !== 'S256'
  ) {
    redirect('/');
  }

  const [ws] = await getDb()
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ctx.workspaceId))
    .limit(1);

  const requested = expandRequestedScopes(get('scope') || null);
  const granted = validateScopes(requested, scopesForRole(ctx.role));

  return (
    <OauthConsentScreen
      clientName={client.clientName}
      workspaceName={ws?.name ?? 'your workspace'}
      scopes={granted}
      hidden={{
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        scope: get('scope'),
        state: get('state'),
      }}
    />
  );
}
