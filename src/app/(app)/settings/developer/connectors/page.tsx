import { and, eq, inArray } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { ConnectorsPanel } from './connectors-panel';

export const dynamic = 'force-dynamic';

// Developer > Connectors (#141). Surfaces the chat-bridge install backend
// (/api/admin/chat-bridge, shipped v0.9.0 G7) with a Slack/Discord type-picker
// create flow and a themed empty state. Admin-gated — installs write workspace
// webhook rows.
export default async function ConnectorsPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/settings/developer');

  const hooks = await getDb()
    .select({
      kind: schema.webhooks.kind,
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

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Developer', href: '/settings/developer' as Route }}
        page="Connectors"
      />
      <ConnectorsPanel
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
