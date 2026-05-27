/**
 * v0.9.0 G7 P36 — Discord interactions / events receiver.
 *
 * Flow per request:
 *   1. Read raw body (Ed25519 signs the EXACT bytes).
 *   2. Verify signature against the application's public key (stored in the
 *      workspace's `webhooks.platform_metadata.public_key`).
 *   3. Discord pings with `{type: 1}` during webhook URL configuration — we
 *      respond with `{type: 1}` (PONG) per docs, AFTER signature verification.
 *   4. For inbound messages, resolve via `message_reference` (the parent
 *      message id) and create a Cairn comment.
 *
 * Generic 400 on signature mismatch (retrospective §5).
 *
 * Discord doesn't put the application id in a known body field for arbitrary
 * webhook calls; we use `application_id` from the body when present, otherwise
 * iterate slack/discord-kind webhooks. Real OAuth install (P37) will tag every
 * inbound with a known application id.
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { ingestInboundReply } from '@/lib/chat/inbound';
import { verifyDiscordSignature } from '@/lib/chat/verify-discord';
import { logger } from '@/lib/observability/logger';
import { RateLimiter, clientIp } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

const REJECT = NextResponse.json({ error: 'invalid request' }, { status: 400 });

const discordInboundLimiter = new RateLimiter({ limit: 60, windowMs: 60_000 });

function limitKey(applicationId: string | null, req: Request): string {
  const ip = clientIp(req.headers, { trustProxy: process.env.TRUST_PROXY === 'true' });
  return `discord:${applicationId ?? 'unknown'}:${ip}`;
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const ts = req.headers.get('x-signature-timestamp') ?? '';
  const sig = req.headers.get('x-signature-ed25519') ?? '';

  let body: {
    type?: number;
    application_id?: string;
    channel_id?: string;
    id?: string;
    content?: string;
    author?: { id?: string; username?: string; bot?: boolean };
    message_reference?: { message_id?: string; channel_id?: string };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return REJECT;
  }

  const applicationId = typeof body.application_id === 'string' ? body.application_id : null;
  if (!discordInboundLimiter.check(limitKey(applicationId, req)).allowed) return REJECT;

  // Find the workspace's discord-kind webhook. Same cardinality assumption
  // as the Slack handler.
  const candidates = await getDb()
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.kind, 'discord'));
  const match = applicationId
    ? candidates.find(
        (h) =>
          (h.platformMetadata as { application_id?: string } | null)?.application_id ===
          applicationId,
      )
    : null;
  // Without a workspace match we still respond 200 — Discord retries on 5xx
  // and ratchets up; staying quiet is the right move.
  if (!match) return NextResponse.json({ ok: true });

  const publicKeyHex =
    (match.platformMetadata as { public_key?: string } | null)?.public_key ?? '';
  const valid = await verifyDiscordSignature({
    publicKeyHex,
    timestamp: ts,
    signature: sig,
    rawBody: raw,
  });
  if (!valid) {
    await recordAudit(getDb(), {
      workspaceId: match.workspaceId,
      actorUserId: null,
      action: 'chat.signature_rejected',
      metadata: { platform: 'discord' },
    }).catch((err) => {
      logger.warn({ err }, '[chat] discord signature audit write failed');
    });
    return REJECT;
  }

  // Discord interactions: type 1 = PING (URL verification), 2 = APPLICATION_COMMAND,
  // 5 = MODAL_SUBMIT, etc. For P36 we respond to PING and otherwise treat the
  // body as a message-create event if it has the message-create shape.
  if (body.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  // Reply-to-Cairn-message path: the body looks like a Discord Message with
  // `message_reference.message_id` pointing at the original Cairn post.
  if (
    typeof body.content === 'string' &&
    typeof body.channel_id === 'string' &&
    body.message_reference?.message_id &&
    !body.author?.bot
  ) {
    await ingestInboundReply(getDb(), {
      platform: 'discord',
      channelId: body.channel_id,
      messageId: body.message_reference.message_id,
      body: body.content,
      authorPlatformHandle: body.author?.id ?? 'unknown',
      authorDisplayName: body.author?.username ?? null,
    }).catch((err) => {
      logger.warn({ err }, '[chat] discord inbound reply ingestion failed');
    });
  }

  return NextResponse.json({ ok: true });
}
