import { getDb } from '@/db/client';
import { loadClientByClientId } from '@/lib/oauth/clients';
import { revokeTokenForClient } from '@/lib/oauth/exchange';
import { verifyOauthToken } from '@/lib/oauth/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

/** RFC 7009 inherits RFC 6749 §5.2 client-auth errors — same shape as /token. */
function invalidClient(description: string): Response {
  return Response.json(
    { error: 'invalid_client', error_description: description },
    { status: 401, headers: NO_STORE },
  );
}

/**
 * POST /api/oauth/revoke — RFC 7009 token revocation.
 *
 * v0.10.0 G4 — the endpoint now AUTHENTICATES the calling client (RFC 7009
 * §2.1). Credentials travel as `application/x-www-form-urlencoded` fields
 * (`client_id` + `client_secret`), mirroring the token endpoint exactly — the
 * token endpoint only supports `client_secret_post`, so no HTTP Basic here
 * either. Order of checks (auth FIRST, then the no-probe zone):
 *
 *   1. No / unknown `client_id` → 401 invalid_client. Anonymous revocation no
 *      longer works — this is the G4 behavior change.
 *   2. Confidential client (stored secret hash) with a missing or wrong
 *      `client_secret` → 401 invalid_client (constant-time hash compare).
 *      Public clients (`token_endpoint_auth_method=none`) present no secret.
 *   3. AUTHENTICATED from here on: the response is ALWAYS 200 — even for an
 *      unknown, already-revoked, or FOREIGN token — so a caller cannot probe
 *      which tokens exist (RFC 7009 §2.2). A token bound to a different
 *      client_id is silently NOT revoked (see revokeTokenForClient).
 *
 * An audit row (`oauth.token_revoked`) is written only on a real revocation.
 */
export async function POST(req: Request): Promise<Response> {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    // Auth comes first: an unreadable body carries no client_id.
    return invalidClient('client_id is required');
  }

  const clientId = form.get('client_id');
  if (!clientId) {
    return invalidClient('client_id is required');
  }

  const db = getDb();
  const client = await loadClientByClientId(db, clientId);
  if (!client) {
    return invalidClient('client authentication failed');
  }

  // Confidential clients must authenticate with their secret (same check as
  // the token endpoint: sha256 + timingSafeEqual via verifyOauthToken).
  if (client.clientSecretHash) {
    const presented = form.get('client_secret');
    if (!presented || !verifyOauthToken(presented, client.clientSecretHash)) {
      return invalidClient('client authentication failed');
    }
  }

  // Authenticated. Everything below is the silent-200 no-probe zone.
  const token = form.get('token');
  if (token) {
    await revokeTokenForClient(db, {
      token,
      tokenTypeHint: form.get('token_type_hint'),
      clientId,
    });
  }

  // Always 200, empty body (RFC 7009).
  return new Response(null, { status: 200, headers: NO_STORE });
}
