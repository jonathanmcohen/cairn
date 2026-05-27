/**
 * v0.9.0 G7 P37 — Slack slash-command receiver.
 *
 * Slack sends `/cairn <subcommand> <args...>` as a form-urlencoded POST
 * signed with the same v0 HMAC scheme as the events API. The body bytes are
 * what's signed, so we read the raw text BEFORE we parse it.
 *
 * Flow:
 *   1. Read raw form body.
 *   2. Resolve install by `team_id` (chat_bridge_installs unique on
 *      (workspace, platform, team_id)).
 *   3. HMAC-verify with the install's signing_secret; reject with 401 on
 *      missing/invalid signature (this differs from the events API which
 *      returns a generic 400 — slash commands ARE authenticated so the
 *      operator wants the actionable 401 in the Slack UI).
 *   4. Apply per-workspace rate-limit; rejected calls return an ephemeral
 *      "rate limit exceeded" message (still 200 — Slack hides 4xx replies).
 *   5. Parse + execute the command, record `chat.slash_invoked` audit, return
 *      the response_type=ephemeral payload Slack expects.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { checkRateLimit } from '@/lib/chat/ratelimit';
import { executeSlashCommand, parseSlashCommand } from '@/lib/chat/slash';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

function verifySlackSig(rawBody: string, headers: Headers, secret: string): boolean {
  const ts = headers.get('x-slack-request-timestamp');
  const sig = headers.get('x-slack-signature');
  if (!ts || !sig) return false;
  // Reject if older than 5 minutes — Slack's published replay window.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  const base = `v0:${ts}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const teamId = params.get('team_id') ?? '';
  const text = params.get('text') ?? '';
  const userId = params.get('user_id') ?? '';
  const channelId = params.get('channel_id') ?? '';

  if (!teamId) {
    return NextResponse.json({ error: 'missing team_id' }, { status: 401 });
  }

  const db = getDb();
  const [install] = await db
    .select()
    .from(schema.chatBridgeInstalls)
    .where(
      and(
        eq(schema.chatBridgeInstalls.platform, 'slack'),
        eq(schema.chatBridgeInstalls.teamId, teamId),
      ),
    )
    .limit(1);
  if (!install) {
    return NextResponse.json({ error: 'unknown team' }, { status: 401 });
  }
  if (!verifySlackSig(rawBody, req.headers, install.signingSecret)) {
    await recordAudit(db, {
      workspaceId: install.workspaceId,
      actorUserId: null,
      action: 'chat.signature_rejected',
      metadata: { platform: 'slack', source: 'slash' },
    }).catch((err) => {
      logger.warn({ err }, '[chat] slack slash signature audit write failed');
    });
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  const customLimit =
    (install.options as { rateLimit?: number } | null)?.rateLimit ?? undefined;
  const rl = await checkRateLimit({
    workspaceId: install.workspaceId,
    limit: customLimit,
  });
  if (!rl.allowed) {
    return NextResponse.json({ response_type: 'ephemeral', text: 'rate limit exceeded' });
  }

  const cmd = parseSlashCommand(text);
  const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';
  const response = await executeSlashCommand(
    cmd,
    {
      workspaceId: install.workspaceId,
      installId: install.id,
      invokingChatUserId: userId,
      channelId,
    },
    publicUrl,
  );

  await recordAudit(db, {
    workspaceId: install.workspaceId,
    actorUserId: install.installedBy,
    action: 'chat.slash_invoked',
    targetType: 'chat_install',
    targetId: install.id,
    metadata: {
      platform: 'slack',
      command: cmd.kind,
      channel_id: channelId,
    },
  }).catch((err) => {
    logger.warn({ err }, '[chat] slack slash audit write failed');
  });

  return NextResponse.json({
    response_type: 'ephemeral',
    text: response.text,
  });
}
