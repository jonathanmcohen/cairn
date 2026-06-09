import { getDb } from '@/db/client';
import { revokeToken } from '@/lib/oauth/exchange';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/oauth/revoke — RFC 7009 token revocation.
 *
 * Body is `application/x-www-form-urlencoded` with `token` (+ optional
 * `token_type_hint`). We match the token by its access OR refresh hash and set
 * `revoked_at`. Per RFC 7009 §2.2 the response is ALWAYS 200 — even for an
 * unknown/already-revoked token — so a caller cannot probe which tokens exist.
 * An audit row (`oauth.token_revoked`) is written only on a real revocation.
 */
export async function POST(req: Request): Promise<Response> {
  let token: string | null = null;
  let hint: string | null = null;
  try {
    const form = new URLSearchParams(await req.text());
    token = form.get('token');
    hint = form.get('token_type_hint');
  } catch {
    // Malformed body — still a silent 200 per the no-probe principle.
  }

  if (token) {
    await revokeToken(getDb(), { token, tokenTypeHint: hint });
  }

  // Always 200, empty body (RFC 7009).
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}
