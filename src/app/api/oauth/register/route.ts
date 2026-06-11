import { getDb } from '@/db/client';
import { isValidRedirectUri, registerClient } from '@/lib/oauth/clients';
import { getRegisterLock, verifyInitialAccessToken } from '@/lib/oauth/register-lock';
import { checkRegisterRateLimit } from '@/lib/oauth/register-rate-limit';
import { clientIp } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/oauth/register — RFC 7591 dynamic client registration.
 *
 * Unauthenticated by design (MCP clients self-register before any user signs in).
 * Validates that every redirect URI is an absolute http/https URL (open-redirect
 * guard), mints a `client_id`, and — for confidential clients — a one-time
 * `cairn_ocs_` secret stored hashed. Public PKCE clients register without one.
 *
 * v0.10.0 G5 — flood control, checked in this order so a throttled or locked
 * request writes NOTHING:
 *   (a) rate limit FIRST (per-IP + instance-global token buckets, before any
 *       parsing/DB work) → 429 + Retry-After; a broken limiter FAILS CLOSED
 *       → 503 (src/lib/oauth/register-rate-limit.ts);
 *   (b) optional admin registration lock (RFC 7591 §3.1.1): while ON, the
 *       request must carry `Authorization: Bearer <initial access token>` →
 *       missing/invalid → 401 invalid_token (src/lib/oauth/register-lock.ts).
 *       DEFAULT IS OPEN — self-registration keeps working with zero setup;
 *   (c) the pre-G5 validation + registration, unchanged.
 */
export async function POST(req: Request): Promise<Response> {
  // (a) Rate limit before any other work — this is the cheapest check and the
  // surface is unauthenticated. TRUST_PROXY mirrors every other clientIp call
  // site (x-forwarded-for is honored only behind a trusted reverse proxy;
  // otherwise all callers share the 'unknown' bucket and the global ceiling
  // is the effective backstop).
  const ip = clientIp(req.headers, { trustProxy: process.env.TRUST_PROXY === 'true' });
  const rate = checkRegisterRateLimit(ip);
  if (rate.unavailable) {
    // FAIL CLOSED — never let registration run unthrottled when the limiter
    // itself is broken.
    return Response.json(
      { error: 'temporarily_unavailable', error_description: 'rate limiter unavailable' },
      { status: 503 },
    );
  }
  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    return Response.json(
      {
        error: 'too_many_requests',
        error_description:
          rate.scope === 'global'
            ? 'instance-wide client registration rate limit exceeded'
            : 'client registration rate limit exceeded for this address',
      },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  // (b) Optional admin lock — RFC 7591 §3.1.1 initial access token as a
  // Bearer credential. Absent lock state ⇒ open (the default posture).
  const lock = await getRegisterLock(getDb());
  if (lock.locked) {
    const presented = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
    const valid = presented ? await verifyInitialAccessToken(getDb(), presented) : false;
    if (!valid) {
      return Response.json(
        {
          error: 'invalid_token',
          error_description:
            'client registration is locked on this instance; a valid initial access token is required',
        },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } },
      );
    }
  }

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
