/**
 * v0.9.0 G7 P37 — channel-link admin page.
 *
 * Lists every `chat_channel_links` row for the current workspace, joined with
 * the install platform + page title. Admins add new links (install + channel
 * + page + mode) or remove existing ones via a sibling Client Component. All
 * mutation goes through `/api/admin/chat-bridge/channels`.
 */

import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { ChannelLinksManager } from './channel-link-form';

export const dynamic = 'force-dynamic';

export default async function ChatBridgeChannelsPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');

  const db = getDb();

  const links = await db
    .select({
      id: schema.chatChannelLinks.id,
      channelId: schema.chatChannelLinks.channelId,
      linkMode: schema.chatChannelLinks.linkMode,
      linkedAt: schema.chatChannelLinks.linkedAt,
      pageId: schema.pages.id,
      pageTitle: schema.pages.title,
      installId: schema.chatBridgeInstalls.id,
      platform: schema.chatBridgeInstalls.platform,
      teamId: schema.chatBridgeInstalls.teamId,
    })
    .from(schema.chatChannelLinks)
    .innerJoin(
      schema.chatBridgeInstalls,
      eq(schema.chatChannelLinks.installId, schema.chatBridgeInstalls.id),
    )
    .innerJoin(schema.pages, eq(schema.chatChannelLinks.pageId, schema.pages.id))
    .where(eq(schema.chatChannelLinks.workspaceId, ctx.workspaceId));

  const installs = await db
    .select({
      id: schema.chatBridgeInstalls.id,
      platform: schema.chatBridgeInstalls.platform,
      teamId: schema.chatBridgeInstalls.teamId,
    })
    .from(schema.chatBridgeInstalls)
    .where(eq(schema.chatBridgeInstalls.workspaceId, ctx.workspaceId));

  // Encrypted-page filter applied client-side via the same predicate used by
  // the sync engine — operators shouldn't be offered an encrypted page as a
  // link target.
  const pages = await db
    .select({ id: schema.pages.id, title: schema.pages.title })
    .from(schema.pages)
    .where(
      and(eq(schema.pages.workspaceId, ctx.workspaceId), eq(schema.pages.encrypted, false)),
    )
    .limit(500);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Chat bridge — channel links</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect a Slack or Discord channel to a Cairn page. In <b>sync</b> mode, messages from
          the channel append as comments and new comments post back to the channel. In <b>notify</b>
          mode, only outbound notifications fire.
        </p>
      </header>
      <ChannelLinksManager
        links={links.map((l) => ({
          id: l.id,
          channelId: l.channelId,
          linkMode: l.linkMode,
          linkedAt: l.linkedAt.toISOString(),
          pageId: l.pageId,
          pageTitle: l.pageTitle,
          installId: l.installId,
          platform: l.platform,
          teamId: l.teamId,
        }))}
        installs={installs}
        pages={pages}
      />
    </div>
  );
}
