/**
 * v0.9.0 G7 P37 — channel-link CRUD (admin only).
 *
 * POST creates a `chat_channel_links` row (one channel ↔ one page, in either
 * `notify` or `sync` mode). DELETE removes by `id`. Both gate on
 * `requireRole('admin')` and write a `chat.channel_linked` /
 * `chat.channel_unlinked` audit row.
 *
 * The route is intentionally narrow — listing happens in the RSC page, so
 * there's no GET here (the page reads the DB directly).
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const LinkMode = z.enum(['notify', 'sync']);

const PostBody = z.object({
  installId: z.uuid(),
  channelId: z.string().min(1).max(255),
  pageId: z.uuid(),
  linkMode: LinkMode,
});

const DeleteBody = z.object({
  id: z.uuid(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = PostBody.parse(await req.json());
    const db = getDb();

    // Confirm the install belongs to the caller's workspace — defense-in-depth
    // against cross-workspace mutation.
    const [install] = await db
      .select()
      .from(schema.chatBridgeInstalls)
      .where(
        and(
          eq(schema.chatBridgeInstalls.id, parsed.installId),
          eq(schema.chatBridgeInstalls.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1);
    if (!install) {
      return NextResponse.json({ error: 'install not found' }, { status: 404 });
    }

    // Page must also belong to the caller's workspace (cross-tenant 404).
    const [page] = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(
        and(eq(schema.pages.id, parsed.pageId), eq(schema.pages.workspaceId, ctx.workspaceId)),
      )
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: 'page not found' }, { status: 404 });
    }

    const [row] = await db
      .insert(schema.chatChannelLinks)
      .values({
        workspaceId: ctx.workspaceId,
        installId: parsed.installId,
        channelId: parsed.channelId,
        pageId: parsed.pageId,
        linkMode: parsed.linkMode,
        linkedBy: ctx.userId,
      })
      .returning();
    if (!row) {
      return NextResponse.json({ error: 'insert failed' }, { status: 500 });
    }

    await recordAudit(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'chat.channel_linked',
      targetType: 'chat_channel_link',
      targetId: row.id,
      metadata: {
        platform: install.platform,
        channel_id: parsed.channelId,
        page_id: parsed.pageId,
        link_mode: parsed.linkMode,
      },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = DeleteBody.parse(await req.json());
    const db = getDb();
    const removed = await db
      .delete(schema.chatChannelLinks)
      .where(
        and(
          eq(schema.chatChannelLinks.id, parsed.id),
          eq(schema.chatChannelLinks.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({
        id: schema.chatChannelLinks.id,
        channelId: schema.chatChannelLinks.channelId,
        pageId: schema.chatChannelLinks.pageId,
        linkMode: schema.chatChannelLinks.linkMode,
        installId: schema.chatChannelLinks.installId,
      });
    if (removed.length === 0) {
      return NextResponse.json({ ok: true, op: 'noop' });
    }
    const link = removed[0]!;
    const [install] = await db
      .select({ platform: schema.chatBridgeInstalls.platform })
      .from(schema.chatBridgeInstalls)
      .where(eq(schema.chatBridgeInstalls.id, link.installId))
      .limit(1);
    await recordAudit(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'chat.channel_unlinked',
      targetType: 'chat_channel_link',
      targetId: link.id,
      metadata: {
        platform: install?.platform ?? null,
        channel_id: link.channelId,
        page_id: link.pageId,
        link_mode: link.linkMode,
      },
    });
    return NextResponse.json({ ok: true, op: 'deleted' });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'invalid body', issues: err.issues }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'unknown';
  return NextResponse.json({ error: message }, { status: 500 });
}
