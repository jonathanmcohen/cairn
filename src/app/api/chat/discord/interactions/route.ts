/**
 * v0.9.0 G7 P37 — Discord interactions endpoint (slash commands).
 *
 * Discord slash-commands arrive as application-command interactions
 * (type=2). The platform also pings us (type=1) during the URL-verification
 * handshake; we reply `{type:1}` (PONG) to that without requiring a workspace
 * match — that's the only way Discord can finalize the application setup.
 *
 * For type=2, we expect a single root command `/cairn` with a `subcommand`
 * option (`search` or `create-page`) and one nested string option (`query`
 * or `title`). We rebuild the platform-agnostic raw-text shape
 * (`<subcommand> <args>`) and feed it into `parseSlashCommand` so the slack
 * + discord paths share one parser.
 *
 * The application_id (Discord's "team_id" equivalent — it's actually the
 * snowflake of the application, NOT the guild) is matched against
 * `chat_bridge_installs.team_id` for the Discord install row.
 */

import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { checkRateLimit } from '@/lib/chat/ratelimit';
import { executeSlashCommand, parseSlashCommand } from '@/lib/chat/slash';
import { verifyDiscordSignature } from '@/lib/chat/verify-discord';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const FLAG_EPHEMERAL = 64;

type DiscordOption = {
  name?: string;
  value?: unknown;
  options?: DiscordOption[];
};

type DiscordInteractionBody = {
  type?: number;
  application_id?: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  data?: {
    name?: string;
    options?: DiscordOption[];
  };
};

/**
 * Flatten the Discord option tree into a `<sub> <arg>` text shape the shared
 * `parseSlashCommand` understands. Slash commands defined in the Discord
 * portal as a SUBCOMMAND group send `data.options[0].name = 'search'` plus a
 * nested option carrying the query string.
 */
function flattenOptions(data: DiscordInteractionBody['data']): string {
  if (!data?.options || data.options.length === 0) return data?.name ?? '';
  const parts: string[] = [];
  const walk = (opts: DiscordOption[]): void => {
    for (const opt of opts) {
      if (opt.options && opt.options.length > 0) {
        if (opt.name) parts.push(opt.name);
        walk(opt.options);
      } else if (typeof opt.value === 'string' || typeof opt.value === 'number') {
        parts.push(String(opt.value));
      } else if (opt.name) {
        parts.push(opt.name);
      }
    }
  };
  walk(data.options);
  // Normalise the `create-page` subcommand (Discord forbids spaces in option
  // names) into the shared parser's `create page` form.
  return parts.join(' ').replace(/^create-page\b/, 'create page');
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const sig = req.headers.get('x-signature-ed25519') ?? '';
  const ts = req.headers.get('x-signature-timestamp') ?? '';

  let body: DiscordInteractionBody;
  try {
    body = JSON.parse(raw) as DiscordInteractionBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 401 });
  }

  const appId = typeof body.application_id === 'string' ? body.application_id : '';
  if (!appId) {
    return NextResponse.json({ error: 'missing application_id' }, { status: 401 });
  }

  const db = getDb();
  const [install] = await db
    .select()
    .from(schema.chatBridgeInstalls)
    .where(
      and(
        eq(schema.chatBridgeInstalls.platform, 'discord'),
        eq(schema.chatBridgeInstalls.teamId, appId),
      ),
    )
    .limit(1);
  if (!install) {
    return NextResponse.json({ error: 'unknown application' }, { status: 401 });
  }

  const valid = await verifyDiscordSignature({
    publicKeyHex: install.signingSecret,
    timestamp: ts,
    signature: sig,
    rawBody: raw,
  });
  if (!valid) {
    await recordAudit(db, {
      workspaceId: install.workspaceId,
      actorUserId: null,
      action: 'chat.signature_rejected',
      metadata: { platform: 'discord', source: 'slash' },
    }).catch((err) => {
      logger.warn({ err }, '[chat] discord slash signature audit write failed');
    });
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  if (body.type === INTERACTION_TYPE_PING) {
    return NextResponse.json({ type: 1 });
  }

  if (body.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
    // Unknown interaction type — ack-without-action so Discord doesn't retry.
    return NextResponse.json({ type: 4, data: { content: 'unsupported', flags: FLAG_EPHEMERAL } });
  }

  const customLimit =
    (install.options as { rateLimit?: number } | null)?.rateLimit ?? undefined;
  const rl = await checkRateLimit({
    workspaceId: install.workspaceId,
    limit: customLimit,
  });
  if (!rl.allowed) {
    return NextResponse.json({
      type: 4,
      data: { content: 'rate limit exceeded', flags: FLAG_EPHEMERAL },
    });
  }

  const text = flattenOptions(body.data);
  const cmd = parseSlashCommand(text);
  const userId = body.member?.user?.id ?? body.user?.id ?? '';
  const channelId = body.channel_id ?? '';
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
      platform: 'discord',
      command: cmd.kind,
      channel_id: channelId,
    },
  }).catch((err) => {
    logger.warn({ err }, '[chat] discord slash audit write failed');
  });

  return NextResponse.json({
    type: 4,
    data: { content: response.text, flags: FLAG_EPHEMERAL },
  });
}
