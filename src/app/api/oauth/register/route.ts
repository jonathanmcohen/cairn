import { getDb } from '@/db/client';
import { isValidRedirectUri, registerClient } from '@/lib/oauth/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/oauth/register — RFC 7591 dynamic client registration.
 *
 * Unauthenticated by design (MCP clients self-register before any user signs in).
 * Validates that every redirect URI is an absolute http/https URL (open-redirect
 * guard), mints a `client_id`, and — for confidential clients — a one-time
 * `cairn_ocs_` secret stored hashed. Public PKCE clients register without one.
 */
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  const clientName =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim()
      : 'OAuth client';

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : [];

  if (redirectUris.length === 0 || !redirectUris.every(isValidRedirectUri)) {
    return Response.json(
      {
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris must be a non-empty list of absolute http(s) URLs',
      },
      { status: 400 },
    );
  }

  // A client is confidential only if it explicitly asks for a secret-bearing
  // auth method. The MCP default is `none` (public PKCE client).
  const authMethod =
    typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
  const confidential = authMethod !== 'none';

  const { row, clientSecret } = await registerClient(getDb(), {
    clientName,
    redirectUris,
    confidential,
  });

  const response: Record<string, unknown> = {
    client_id: row.clientId,
    client_name: row.clientName,
    redirect_uris: row.redirectUris,
    grant_types: row.grantTypes,
    token_endpoint_auth_method: confidential ? 'client_secret_post' : 'none',
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
  };
  if (clientSecret) {
    response.client_secret = clientSecret;
  }

  return Response.json(response, { status: 201 });
}
