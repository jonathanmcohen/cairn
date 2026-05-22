import { signFileUrl, verifyFileUrl } from '@/lib/files/signing';

/** One cookie per page so multiple protected pages do not collide. */
export function cookieNameFor(pageId: string): string {
  return `cairn_pub_${pageId}`;
}

type IssueInput = {
  pageId: string;
  secret: string;
  /** Seconds from now. Ignored if `expiresAt` (an absolute unix-seconds) is given. */
  ttlSeconds?: number;
  expiresAt?: number;
};

/**
 * Mint the cookie *value* `<exp>.<sig>` where `sig = HMAC(secret, "<pageId>.<exp>")`.
 * We deliberately reuse the audited file-URL HMAC (`signFileUrl`) with `fileId := pageId`
 * and `expiresAt := exp` — so this introduces NO new secret and NO new crypto.
 */
export function issueAccessCookieValue(input: IssueInput): string {
  const exp = input.expiresAt ?? Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 12 * 60 * 60);
  const sig = signFileUrl({ fileId: input.pageId, expiresAt: exp, secret: input.secret });
  return `${exp}.${sig}`;
}

type VerifyInput = { pageId: string; value: string; secret: string };

/** True iff `value` is a well-formed, signature-valid, unexpired cookie for `pageId`. */
export function verifyAccessCookieValue(input: VerifyInput): boolean {
  const dot = input.value.indexOf('.');
  if (dot <= 0) return false;
  const expStr = input.value.slice(0, dot);
  const sig = input.value.slice(dot + 1);
  if (!/^\d+$/.test(expStr) || sig.length === 0) return false;
  const exp = Number(expStr);
  // verifyFileUrl checks BOTH the time gate (exp in the future) AND the timing-safe HMAC.
  return verifyFileUrl({ fileId: input.pageId, expiresAt: exp, sig, secret: input.secret });
}
