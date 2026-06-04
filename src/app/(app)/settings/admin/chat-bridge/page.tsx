/**
 * v0.9.0 G7 P36 — chat-bridge admin UI (admin-only).
 *
 * Shows per-platform install status. The form is a Client Component (paste
 * the webhook URL + signing secret / public key) — `requireRole('admin')` on
 * this server component gates access, the same check is repeated in the
 * `/api/admin/chat-bridge` route for defense in depth.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { ChatBridgeForm } from './chat-bridge-form';
import { ChatOauthButtons } from './chat-oauth-buttons';

export const dynamic = 'force-dynamic';

export default async function ChatBridgePage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');

  const hooks = await getDb()
    .select({
      id: schema.webhooks.id,
      kind: schema.webhooks.kind,
      url: schema.webhooks.url,
      active: schema.webhooks.active,
      platformMetadata: schema.webhooks.platformMetadata,
    })
    .from(schema.webhooks)
    .where(
      and(
        eq(schema.webhooks.workspaceId, ctx.workspaceId),
        inArray(schema.webhooks.kind, ['slack', 'discord']),
      ),
    );
  const slack = hooks.find((h) => h.kind === 'slack') ?? null;
  const discord = hooks.find((h) => h.kind === 'discord') ?? null;

  const oauthRows = await getDb()
    .select({
      platform: schema.chatOauthInstalls.platform,
      externalTeamId: schema.chatOauthInstalls.externalTeamId,
      revokedAt: schema.chatOauthInstalls.revokedAt,
    })
    .from(schema.chatOauthInstalls)
    .where(eq(schema.chatOauthInstalls.workspaceId, ctx.workspaceId));
  const slackOauth = oauthRows.find((r) => r.platform === 'slack' && r.revokedAt === null) ?? null;
  const discordOauth =
    oauthRows.find((r) => r.platform === 'discord' && r.revokedAt === null) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin/audit' as Route }}
        page="Chat bridge"
      />
      <header>
        <h1 className="text-2xl font-semibold">Chat bridge</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Forward page + comment events to Slack or Discord, and let teammates reply in-thread to
          create Cairn comments.
        </p>
      </header>
      <ChatOauthButtons
        slackOauthInstalled={!!slackOauth}
        slackTeam={slackOauth?.externalTeamId ?? null}
        discordOauthInstalled={!!discordOauth}
        discordTeam={discordOauth?.externalTeamId ?? null}
      />
      <ChatBridgeForm
        slackInstalled={!!slack}
        slackTeamId={(slack?.platformMetadata as { team_id?: string } | null)?.team_id ?? null}
        slackChannelId={
          (slack?.platformMetadata as { channel_id?: string } | null)?.channel_id ?? null
        }
        discordInstalled={!!discord}
        discordApplicationId={
          (discord?.platformMetadata as { application_id?: string } | null)?.application_id ?? null
        }
        discordChannelId={
          (discord?.platformMetadata as { channel_id?: string } | null)?.channel_id ?? null
        }
      />
    </div>
  );
}
