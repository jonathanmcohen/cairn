import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 of the exact request body bytes, keyed by the per-hook secret.
 * Returned in the `X-Cairn-Signature` header as `sha256=<hex>`. Receivers
 * recompute over the raw body they read and compare in constant time.
 */
export function signBody(secret: string, body: string): string {
  const mac = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${mac}`;
}

export function verifySignature(secret: string, body: string, header: string): boolean {
  const expected = signBody(secret, body);
  // Both are `sha256=<64 hex>`; lengths are equal on the happy path. Guard
  // against length mismatch so timingSafeEqual never throws on bad input.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
