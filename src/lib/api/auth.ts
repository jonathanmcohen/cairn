import { getDb } from '@/db/client';
import type { AuthContext } from '@/lib/auth/require-role';
import { HttpError } from '@/lib/auth/require-role';
import { verifyKey } from './keys';

const BEARER = /^Bearer\s+(\S+)$/i;

/** Extract `Authorization: Bearer <token>`; null if absent or wrong scheme. */
export function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match ? (match[1] ?? null) : null;
}

/**
 * Authenticate an /api/v1 request by bearer API key. Returns the same
 * AuthContext shape getAuthContext returns, so requireRole/requirePageAccess
 * work unchanged. Throws HttpError(401) on any failure.
 */
export async function requireApiAuth(req: Request): Promise<AuthContext> {
  const token = extractBearer(req);
  if (!token) throw new HttpError(401, 'Missing or malformed Authorization header');
  const ctx = await verifyKey(getDb(), token);
  if (!ctx) throw new HttpError(401, 'Invalid or expired API key');
  return ctx;
}
