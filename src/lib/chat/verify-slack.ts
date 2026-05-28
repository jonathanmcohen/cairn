/**
 * v0.9.0 G7 P36 — Slack Events API signature verification.
 *
 * Slack signs every Events-API POST with HMAC-SHA256 over
 * `v0:${timestamp}:${rawBody}`, keyed by the app's signing secret. The header
 * is `x-slack-signature: v0=<hex>`.
 *
 * We reject if:
 *   • the timestamp is older than 5 minutes (replay protection, per Slack docs).
 *   • the lengths don't match (timing-safe compare would throw otherwise).
 *   • the HMAC doesn't match.
 *
 * The route handler (`src/app/api/chat/slack/events/route.ts`) reads the raw
 * body BEFORE JSON.parse so this function sees the exact bytes Slack signed.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifySlackInput = {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  /** Override clock for tests. */
  nowSec?: number;
};

export function verifySlackSignature(input: VerifySlackInput): boolean {
  if (!input.signingSecret) return false;
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60) return false;
  const baseString = `v0:${input.timestamp}:${input.rawBody}`;
  const expected = `v0=${createHmac('sha256', input.signingSecret).update(baseString).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
