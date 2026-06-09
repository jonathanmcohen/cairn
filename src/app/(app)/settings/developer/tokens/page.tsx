import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { McpConnectionInfo } from '@/components/dev-settings/mcp-connection-info';
import {
  type OauthConnectionRow,
  OauthConnectionsList,
} from '@/components/dev-settings/oauth-connections-list';
import { type DevTokenRow, TokenList } from '@/components/dev-settings/token-list';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { publicOrigin } from '@/lib/url';

export default async function DeveloperSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const rows = await getDb()
    .select({
      id: schema.personalAccessTokens.id,
      name: schema.personalAccessTokens.name,
      tokenPrefix: schema.personalAccessTokens.tokenPrefix,
      scopes: schema.personalAccessTokens.scopes,
      mcpTools: schema.personalAccessTokens.mcpTools,
      lastUsedAt: schema.personalAccessTokens.lastUsedAt,
      expiresAt: schema.personalAccessTokens.expiresAt,
      createdAt: schema.personalAccessTokens.createdAt,
    })
    .from(schema.personalAccessTokens)
    .where(
      and(
        eq(schema.personalAccessTokens.userId, session.user.id),
        isNull(schema.personalAccessTokens.revokedAt),
      ),
    )
    .orderBy(desc(schema.personalAccessTokens.createdAt));

  const initialTokens: DevTokenRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    scopes: r.scopes,
    mcpTools: r.mcpTools,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  // v0.9.16 Plan F — the signed-in user's active OAuth connections (non-revoked,
  // joined to their client) for the connections list.
  const oauthRows = await getDb()
    .select({
      id: schema.oauthTokens.id,
      clientName: schema.oauthClients.clientName,
      scopes: schema.oauthTokens.scopes,
      lastUsedAt: schema.oauthTokens.lastUsedAt,
    })
    .from(schema.oauthTokens)
    .innerJoin(schema.oauthClients, eq(schema.oauthClients.clientId, schema.oauthTokens.clientId))
    .where(
      and(eq(schema.oauthTokens.userId, session.user.id), isNull(schema.oauthTokens.revokedAt)),
    )
    .orderBy(desc(schema.oauthTokens.createdAt));

  const initialConnections: OauthConnectionRow[] = oauthRows.map((r) => ({
    id: r.id,
    clientName: r.clientName,
    scopes: r.scopes,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));

  // Real public origin (forwarded-host aware) — see src/lib/url.ts / GH #50.
  const publicUrl = await publicOrigin();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Developer', href: '/settings/developer' as Route }}
        page="Personal tokens"
      />
      <header>
        <h1 className="font-semibold text-2xl">Connect tools to Cairn</h1>
        <p className="text-muted-foreground text-sm">
          Connect Claude Desktop or Cursor with OAuth — no token to paste. Or mint a personal access
          token for scripts and the API. Both are scoped to your account and obey your workspace
          permissions.
        </p>
      </header>
      <OauthConnectionsList initial={initialConnections} />
      <McpConnectionInfo publicUrl={publicUrl} />
      <TokenList initialTokens={initialTokens} />
    </main>
  );
}
