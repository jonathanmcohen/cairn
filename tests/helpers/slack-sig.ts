/**
 * v0.9.0 G7 P37 — tiny HMAC signer mirroring Slack's v0 scheme for use in
 * slash-command + sync tests. Returns the timestamp + signature pair the
 * route handler reads from `x-slack-request-timestamp` / `x-slack-signature`.
 */
import { createHmac } from 'node:crypto';

export function signSlack(
  body: string,
  signingSecret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { ts: string; v0: string } {
  const ts = String(nowSec);
  const base = `v0:${ts}:${body}`;
  const v0 = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;
  return { ts, v0 };
}
