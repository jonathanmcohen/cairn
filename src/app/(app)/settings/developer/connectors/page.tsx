import { and, eq, inArray } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { listConnectors } from '@/lib/connectors/manage';
import { ConnectorsPanel } from './connectors-panel';
import { CreateConnectorFlow } from './create-connector-flow';
import { DatabaseConnectorsList } from './database-connectors-list';

export const dynamic = 'force-dynamic';

// Developer > Connectors (#141, #165). Surfaces BOTH database connectors
// (Sheets/Airtable/CSV — create flow + list + per-connector config + conflict
// inbox) AND the chat-bridge install backend (Slack/Discord, shipped v0.9.0 G7).
// Admin-gated — installs write workspace webhook rows.
export default async function ConnectorsPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/settings/developer');

  const db = getDb();

  const connectors = await listConnectors(db, ctx.workspaceId);
  const connectorRows = connectors.map((c) => ({
    ...c,
    lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
  }));

  const databases = await db
    .select({ id: schema.databases.id, name: schema.databases.name })
    .from(schema.databases)
    .where(eq(schema.databases.workspaceId, ctx.workspaceId))
    .limit(500);

  const hooks = await db
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
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Developer', href: '/settings/developer' as Route }}
        page="Connectors"
      />

      <section className="space-y-4">
        <CreateConnectorFlow databases={databases} />
        <DatabaseConnectorsList connectors={connectorRows} />
      </section>

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
