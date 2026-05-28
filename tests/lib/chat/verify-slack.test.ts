import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySlackSignature } from '@/lib/chat/verify-slack';

function sign(secret: string, ts: string, body: string): string {
  const base = `v0:${ts}:${body}`;
  return `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
}

describe('verifySlackSignature', () => {
  const secret = 'shh';
  const body = '{"event":"message"}';
  const now = 1700000000;

  it('accepts a valid signature within the freshness window', () => {
    const ts = String(now);
    const sig = sign(secret, ts, body);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: sig,
        rawBody: body,
        nowSec: now,
      }),
    ).toBe(true);
  });

  it('rejects a stale timestamp (>5 min)', () => {
    const ts = String(now - 6 * 60);
    const sig = sign(secret, ts, body);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: sig,
        rawBody: body,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const ts = String(now);
    const sig = sign(secret, ts, body);
    const tampered = `X${body.slice(1)}`;
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: sig,
        rawBody: tampered,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it('rejects a wrong-length signature without throwing', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: String(now),
        signature: 'v0=short',
        rawBody: body,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it('rejects when the signing secret is empty', () => {
    const ts = String(now);
    const sig = sign(secret, ts, body);
    expect(
      verifySlackSignature({
        signingSecret: '',
        timestamp: ts,
        signature: sig,
        rawBody: body,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it('rejects non-numeric timestamps', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: 'not-a-number',
        signature: 'v0=00',
        rawBody: body,
        nowSec: now,
      }),
    ).toBe(false);
  });
});
