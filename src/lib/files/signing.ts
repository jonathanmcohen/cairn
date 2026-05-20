import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignInput = { fileId: string; expiresAt: number; secret: string };

export function signFileUrl(input: SignInput): string {
  const h = createHmac('sha256', input.secret);
  h.update(`${input.fileId}.${input.expiresAt}`);
  return h.digest('hex');
}

export type VerifyInput = SignInput & { sig: string };

export function verifyFileUrl(input: VerifyInput): boolean {
  if (input.expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = signFileUrl(input);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(input.sig, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
