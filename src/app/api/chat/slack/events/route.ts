/**
 * v0.9.0 G7 P36 — Slack Events API receiver.
 *
 * Flow per request:
 *   1. Read raw body (HMAC needs the EXACT bytes).
 *   2. Parse JSON; respond to Slack's `url_verification` challenge BEFORE we
 *      lock onto a signing secret — Slack does the challenge during install.
 *   3. Match team_id → workspace via `webhooks.kind = 'slack'` rows.
 *   4. Verify HMAC + freshness; on failure audit + return generic 400.
 *   5. Handle message events with `thread_ts` (replies into Cairn threads).
 *      Top-level messages are ignored.
 *
 * Generic 400 on signature mismatch (NOT 401): retrospective §5 — return the
 * same body for "no workspace match", "stale ts", and "bad sig" so attackers
 * can't probe for valid team_ids.
 *
 * Per-workspace rate-limit (spec §6): we apply a small in-process token bucket
 * keyed by (workspaceId | ip). Single-instance only — documented in
 * SECURITY.md for the existing limiters.
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { ingestInboundReply } from '@/lib/chat/inbound';
import { verifySlackSignature } from '@/lib/chat/verify-slack';
import { logger } from '@/lib/observability/logger';
import { RateLimiter, clientIp } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

const REJECT = NextResponse.json({ error: 'invalid request' }, { status: 400 });

const slackInboundLimiter = new RateLimiter({ limit: 60, windowMs: 60_000 });

function limitKey(team: string | null, req: Request): string {
  const ip = clientIp(req.headers, { trustProxy: process.env.TRUST_PROXY === 'true' });
  return `slack:${team ?? 'unknown'}:${ip}`;
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const ts = req.headers.get('x-slack-request-timestamp') ?? '';
  const sig = req.headers.get('x-slack-signature') ?? '';

  let body: {
    type?: string;
    challenge?: string;
    team_id?: string;
    event?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return REJECT;
  }

  // Slack's URL-verification handshake — no signing secret yet. Return the
  // challenge verbatim per docs; rate-limit still applies (per IP).
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    if (!slackInboundLimiter.check(limitKey(null, req)).allowed) return REJECT;
    return NextResponse.json({ challenge: body.challenge });
  }

  const team = typeof body.team_id === 'string' ? body.team_id : null;
  if (!slackInboundLimiter.check(limitKey(team, req)).allowed) return REJECT;
  if (!team) return NextResponse.json({ ok: true });

  // Find the workspace's Slack-kind webhook by matching team_id in
  // platform_metadata. In v0.9 we expect a small N of Slack installs per
  // instance; if cardinality grows we'd index `(platform_metadata->>'team_id')`.
  const candidates = await getDb()
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.kind, 'slack'));
  const match = candidates.find(
    (h) => (h.platformMetadata as { team_id?: string } | null)?.team_id === team,
  );
  if (!match) return NextResponse.json({ ok: true });

  const signingSecret =
    (match.platformMetadata as { signing_secret?: string } | null)?.signing_secret ?? '';
  const valid = verifySlackSignature({
    signingSecret,
    timestamp: ts,
    signature: sig,
    rawBody: raw,
  });
  if (!valid) {
    await recordAudit(getDb(), {
      workspaceId: match.workspaceId,
      actorUserId: null,
      action: 'chat.signature_rejected',
      metadata: { platform: 'slack' },
    }).catch((err) => {
      logger.warn({ err }, '[chat] slack signature audit write failed');
    });
    return REJECT;
  }

  const ev = body.event as
    | {
        type?: string;
        text?: string;
        user?: string;
        channel?: string;
        thread_ts?: string;
        bot_id?: string;
      }
    | undefined;

  // Only act on threaded human messages — ignore bot loopback, channel-level
  // posts, and non-message events.
  if (
    ev?.type === 'message' &&
    typeof ev.text === 'string' &&
    typeof ev.channel === 'string' &&
    typeof ev.thread_ts === 'string' &&
    !ev.bot_id
  ) {
    await ingestInboundReply(getDb(), {
      platform: 'slack',
      channelId: ev.channel,
      threadTs: ev.thread_ts,
      body: ev.text,
      authorPlatformHandle: ev.user ?? 'unknown',
    }).catch((err) => {
      logger.warn({ err }, '[chat] slack inbound reply ingestion failed');
    });
  }

  return NextResponse.json({ ok: true });
}
