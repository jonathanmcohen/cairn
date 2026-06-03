import { desc, eq } from 'drizzle-orm';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IdpAddButtons } from '@/components/admin/sso/idp-add-buttons';
import { ScimTokenList, type ScimTokenRow } from '@/components/admin/sso/scim-token-list';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

const SSO_AUDIT_ACTIONS = new Set<string>([
  'sso.idp.created',
  'sso.idp.updated',
  'sso.idp.deleted',
  'sso.scim.token.minted',
  'sso.scim.token.revoked',
]);

export default async function AdminSsoPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  const db = getDb();

  const idps = await db
    .select({
      id: schema.idpConfigurations.id,
      type: schema.idpConfigurations.type,
      name: schema.idpConfigurations.name,
      enabled: schema.idpConfigurations.enabled,
      createdAt: schema.idpConfigurations.createdAt,
    })
    .from(schema.idpConfigurations)
    .where(eq(schema.idpConfigurations.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.idpConfigurations.createdAt));

  const tokens: ScimTokenRow[] = (
    await db
      .select({
        id: schema.scimTokens.id,
        name: schema.scimTokens.name,
        scopes: schema.scimTokens.scopes,
        createdAt: schema.scimTokens.createdAt,
        lastUsedAt: schema.scimTokens.lastUsedAt,
      })
      .from(schema.scimTokens)
      .where(eq(schema.scimTokens.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.scimTokens.createdAt))
  ).map((r) => ({
    id: r.id,
    name: r.name,
    scopes: r.scopes ?? [],
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));

  const recentAudit = await db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      createdAt: schema.auditLog.createdAt,
      metadata: schema.auditLog.metadata,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(50);

  const ssoAudit = recentAudit.filter((r) => SSO_AUDIT_ACTIONS.has(r.action));

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header>
        <h1 className="text-3xl font-semibold">Single sign-on</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure OIDC, SAML, and SCIM provisioning for this workspace.
        </p>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Identity providers</h2>
          <IdpAddButtons />
        </div>
        {idps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No identity providers configured.</p>
        ) : (
          <ul className="space-y-2">
            {idps.map((idp) => (
              <li key={idp.id} className="flex items-center gap-3 rounded border bg-card p-3">
                <div className="flex-1">
                  <div className="font-medium">{idp.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {idp.type.toUpperCase()} · {idp.enabled ? 'Enabled' : 'Disabled'} · Created{' '}
                    {new Date(idp.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link
                    href={
                      (idp.type === 'oidc'
                        ? `/settings/admin/sso/oidc/${idp.id}/edit`
                        : `/settings/admin/sso/saml/${idp.id}/edit`) as Route
                    }
                  >
                    Edit
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">SCIM 2.0 provisioning tokens</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Bearer tokens for the SCIM 2.0 endpoint at <code>/api/scim/v2/Users</code> and{' '}
          <code>/Groups</code>. Filters: <code>userName eq</code> and{' '}
          <code>meta.lastModified gt</code> only.
        </p>
        <ScimTokenList initial={tokens} />
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Recent SSO audit entries</h2>
        {ssoAudit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent SSO audit events.</p>
        ) : (
          <ul className="space-y-1">
            {ssoAudit.map((r) => (
              <li key={r.id} className="text-sm">
                <span className="text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </span>{' '}
                · <code className="text-xs">{r.action}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
