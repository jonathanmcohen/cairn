/**
 * v0.9.6 G8 — login-ticket sign/verify. Pure crypto, no DB.
 */
import { describe, expect, it } from 'vitest';
import { signLoginTicket, verifyLoginTicket } from '@/lib/auth/passkey-ticket';

const SECRET = 'k'.repeat(48);

describe('passkey login ticket', () => {
  it('round-trips a valid ticket back to its userId', () => {
    const t = signLoginTicket('user-123', SECRET, 60_000);
    expect(verifyLoginTicket(t, SECRET)).toBe('user-123');
  });

  it('rejects a tampered userId', () => {
    const t = signLoginTicket('user-123', SECRET, 60_000);
    // The userId is base64url-encoded in the first segment, so swap that segment
    // for a different user's encoding while keeping the original signature —
    // the HMAC over the (now-mismatched) payload must fail.
    const [, exp, sig] = t.split('.');
    const forgedId = Buffer.from('user-456', 'utf8').toString('base64url');
    const tampered = `${forgedId}.${exp}.${sig}`;
    expect(verifyLoginTicket(tampered, SECRET)).toBeNull();
  });

  it('rejects a ticket signed with a different secret', () => {
    const t = signLoginTicket('user-123', SECRET, 60_000);
    expect(verifyLoginTicket(t, 'x'.repeat(48))).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const t = signLoginTicket('user-123', SECRET, -1);
    expect(verifyLoginTicket(t, SECRET)).toBeNull();
  });

  it('rejects a malformed ticket', () => {
    expect(verifyLoginTicket('garbage', SECRET)).toBeNull();
    expect(verifyLoginTicket('', SECRET)).toBeNull();
  });
});
