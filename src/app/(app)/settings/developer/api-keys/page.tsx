import { desc, eq } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { type ApiKeyRow, ApiKeysManager } from '@/components/settings/api-keys-manager';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { CopyButton } from '@/components/settings/copy-button';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';
import { publicOrigin } from '@/lib/url';

export default async function ApiKeysSettingsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  // Key management is admin-only (matches the workspace-admin-configured spec).
  if (!hasMinRole(ctx.role, 'admin')) redirect('/');

  // Never select tokenHash — the plaintext is unrecoverable by design.
  const rows = await getDb()
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      tokenPrefix: schema.apiKeys.tokenPrefix,
      role: schema.apiKeys.role,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      expiresAt: schema.apiKeys.expiresAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.apiKeys.createdAt));

  const initialKeys: ApiKeyRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    role: r.role,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  // Deploy-correct MCP endpoint. publicOrigin() resolves the real public origin
  // from PUBLIC_URL / the forwarded request host / NEXTAUTH_URL (never the
  // build-time localhost default — see GH #50 / src/lib/url.ts). The MCP HTTP
  // transport route is src/app/api/mcp/route.ts → `/api/mcp`.
  const mcpUrl = `${await publicOrigin()}/api/mcp`;
  // Canonical PAT/MCP scope superset — source of truth: ROLE_SCOPES.owner in
  // src/lib/auth/token.ts (kept in sync with that map).
  const scopes = [
    'pages:read',
    'pages:write',
    'pages:destructive',
    'databases:read',
    'databases:write',
    'databases:destructive',
    'comments:read',
    'comments:write',
    'comments:destructive',
    'files:read',
    'files:write',
    'files:destructive',
    'admin',
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsBreadcrumb
        section={{ label: 'Developer', href: '/settings/developer' as Route }}
        page="API keys"
      />
      <h1 className="mb-2 text-3xl font-semibold">API keys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Keys authenticate requests to the <code>/api/v1</code> HTTP API via{' '}
        <code>Authorization: Bearer cairn_sk_…</code>. A key acts with the role you assign and on
        behalf of its creator. The full token is shown only once when created.
      </p>
      <ApiKeysManager initialKeys={initialKeys} />

      <section className="mt-8 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">MCP connection</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect an MCP client (Claude Desktop, Cursor, …) over the streamable-HTTP transport using
          a personal access token as a <code>Bearer</code> credential. Mint tokens under{' '}
          <code>Settings → Developer → Personal tokens</code>.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Endpoint</dt>
            <dd className="flex flex-1 items-center gap-2 break-all font-mono">
              {mcpUrl}
              <CopyButton value={mcpUrl} label="Copy MCP endpoint" />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Scopes</dt>
            <dd className="font-mono">{scopes.join(', ')}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
