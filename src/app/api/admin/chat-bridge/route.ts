/**
 * v0.9.0 G7 P36 — chat-bridge install API (admin-only).
 *
 * POST upserts a `webhooks` row of `kind in {slack, discord}` for the caller's
 * workspace, replacing the platform metadata (signing secret + team/app id +
 * channel id). The secret column gets a random non-PII value — we do NOT need
 * the v0.5 HMAC for chat-bridge deliveries (Slack/Discord ignore unknown
 * headers), but the column is NOT NULL so we set a placeholder.
 *
 * DELETE removes the install. The webhook row is hard-deleted (the chat
 * bridge is workspace-opt-in; there's nothing to retain).
 *
 * Both actions write a `chat.install_changed` audit row whose metadata
 * records the platform + the redacted shape of what changed — NEVER the
 * raw secret.
 */

import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { recordAudit } from '@/lib/audit/record';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';

const Platform = z.enum(['slack', 'discord']);

const InstallBody = z.object({
  platform: Platform,
  webhookUrl: z.url(),
  // Slack: signing_secret; Discord: public_key (hex). One of these is required
  // for inbound signature verification.
  signingSecret: z.string().min(1).optional(),
  publicKey: z.string().min(1).optional(),
  // Stable platform identifiers.
  teamId: z.string().min(1).optional(),
  applicationId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
});

const DeleteBody = z.object({ platform: Platform });

const DEFAULT_EVENTS = ['page.created', 'page.updated', 'comment.created'];

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = InstallBody.parse(await req.json());
    await assertPublicUrl(parsed.webhookUrl);

    if (parsed.platform === 'slack' && !parsed.signingSecret) {
      return NextResponse.json(
        { error: 'signingSecret is required for Slack' },
        { status: 400 },
      );
    }
    if (parsed.platform === 'discord' && !parsed.publicKey) {
      return NextResponse.json(
        { error: 'publicKey is required for Discord' },
        { status: 400 },
      );
    }

    const platformMetadata: Record<string, unknown> = {};
    if (parsed.signingSecret) platformMetadata.signing_secret = parsed.signingSecret;
    if (parsed.publicKey) platformMetadata.public_key = parsed.publicKey;
    if (parsed.teamId) platformMetadata.team_id = parsed.teamId;
    if (parsed.applicationId) platformMetadata.application_id = parsed.applicationId;
    if (parsed.channelId) platformMetadata.channel_id = parsed.channelId;

    const db = getDb();
    // Find existing install for (workspace, platform).
    const [existing] = await db
      .select()
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.workspaceId, ctx.workspaceId),
          eq(schema.webhooks.kind, parsed.platform),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.webhooks)
        .set({
          url: parsed.webhookUrl,
          platformMetadata,
          active: true,
        })
        .where(eq(schema.webhooks.id, existing.id));
    } else {
      await db.insert(schema.webhooks).values({
        workspaceId: ctx.workspaceId,
        url: parsed.webhookUrl,
        events: DEFAULT_EVENTS,
        // Random non-functional placeholder — Slack/Discord ignore our
        // X-Cairn-Signature; the column itself is NOT NULL.
        secret: `cairn_whsec_${randomBytes(24).toString('hex')}`,
        active: true,
        kind: parsed.platform,
        platformMetadata,
      });
    }

    await recordAudit(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'chat.install_changed',
      targetType: 'webhook',
      metadata: {
        platform: parsed.platform,
        op: existing ? 'updated' : 'created',
        // Record only which fields the operator set — NOT the values.
        fields: Object.keys(platformMetadata),
      },
    });

    return NextResponse.json({ ok: true, op: existing ? 'updated' : 'created' });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = DeleteBody.parse(await req.json());
    const db = getDb();
    const removed = await db
      .delete(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.workspaceId, ctx.workspaceId),
          eq(schema.webhooks.kind, parsed.platform),
        ),
      )
      .returning({ id: schema.webhooks.id });
    if (removed.length === 0) {
      return NextResponse.json({ ok: true, op: 'noop' });
    }
    await recordAudit(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'chat.install_changed',
      targetType: 'webhook',
      metadata: { platform: parsed.platform, op: 'deleted' },
    });
    return NextResponse.json({ ok: true, op: 'deleted' });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

