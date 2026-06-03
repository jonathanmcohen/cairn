import { clientIp } from '@/lib/security/rate-limit';

/**
 * #192 — resolve the real client IP for an `auth_sessions` row. When the
 * deployment is NOT behind a trusted proxy (TRUST_PROXY!=='true') we refuse to
 * persist a forwarded value — it would be the Docker bridge gateway, not the
 * user. clientIp() returns the literal 'unknown' sentinel in that case; we
 * map it to null so the sessions UI hides the field entirely.
 */
export function resolveSignInIp(headers: Headers, opts: { trustProxy: boolean }): string | null {
  if (!opts.trustProxy) return null;
  const ip = clientIp(headers, { trustProxy: true });
  return ip === 'unknown' ? null : ip;
}
