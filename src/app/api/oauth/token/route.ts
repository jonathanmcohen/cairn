import { getDb } from '@/db/client';
import { loadClientByClientId } from '@/lib/oauth/clients';
import { codeToTokens, refreshTokens } from '@/lib/oauth/exchange';
import { verifyOauthToken } from '@/lib/oauth/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokenError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
  );
}

/**
 * POST /api/oauth/token — OAuth token endpoint (RFC 6749 §3.2).
 * Body is `application/x-www-form-urlencoded`. Dispatches on `grant_type`:
 *   - authorization_code → consume the code, verify PKCE, issue access+refresh.
 *   - refresh_token      → rotate (Task 7).
 *
 * A confidential client must present its `client_secret`; a public PKCE client
 * presents none (PKCE is what authenticates the exchange).
 */
export async function POST(req: Request): Promise<Response> {
  let form: URLSearchParams;
  try {
    const text = await req.text();
    form = new URLSearchParams(text);
  } catch {
    return tokenError('invalid_request', 'malformed request body');
  }

  const grantType = form.get('grant_type');
  const clientId = form.get('client_id');
  if (!clientId) {
    return tokenError('invalid_client', 'client_id is required');
  }

  const db = getDb();
  const client = await loadClientByClientId(db, clientId);
  if (!client) {
    return tokenError('invalid_client', 'unknown client_id', 401);
  }

  // Confidential clients must authenticate with their secret.
  if (client.clientSecretHash) {
    const presented = form.get('client_secret');
    if (!presented || !verifyOauthToken(presented, client.clientSecretHash)) {
      return tokenError('invalid_client', 'client authentication failed', 401);
    }
  }

  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const redirectUri = form.get('redirect_uri');
    const codeVerifier = form.get('code_verifier');
    if (!code || !redirectUri) {
      return tokenError('invalid_request', 'code and redirect_uri are required');
    }

    const result = await codeToTokens(db, {
      code,
      redirectUri,
      clientId,
      codeVerifier,
    });
    if ('kind' in result) {
      return tokenError(result.kind, result.description);
    }

    return Response.json(
      {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        scope: result.scopes.join(' '),
      },
      { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
    );
  }

  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token');
    if (!refreshToken) {
      return tokenError('invalid_request', 'refresh_token is required');
    }
    const result = await refreshTokens(db, { refreshToken, clientId });
    if ('kind' in result) {
      return tokenError(result.kind, result.description);
    }
    return Response.json(
      {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        scope: result.scopes.join(' '),
      },
      { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
    );
  }

  return tokenError('unsupported_grant_type', `grant_type ${grantType} is not supported`);
}
