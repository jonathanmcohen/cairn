import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listRegisteredClients } from '@/lib/oauth/admin-clients';
import { OauthClientsView } from './oauth-clients-view';

export const dynamic = 'force-dynamic';

// v0.10.0 D3 — settings-hub home for the instance OAuth client registry.
// RFC 7591 registration is unauthenticated by design, so this is the only
// surface where an operator can SEE (and purge) the client applications that
// self-registered against /api/oauth/register. The RSC gates + reads; the
// view renders the i18n copy + per-row delete. Deliberately distinct from
// Settings → Developer → Tokens, which lists the signed-in USER's grant
// connections (oauth_tokens rows), not the registered apps.
export default async function OauthClientsSettingsPage() {
  await requireRole('admin');
  const clients = await listRegisteredClients(getDb());

  return (
    <section className="space-y-6">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="OAuth clients"
      />
      <OauthClientsView
        clients={clients.map((c) => ({
          id: c.id,
          clientId: c.clientId,
          name: c.name,
          redirectUris: c.redirectUris,
          confidential: c.confidential,
          createdAt: c.createdAt.toISOString(),
          activeGrants: c.activeGrants,
          totalGrants: c.totalGrants,
        }))}
      />
    </section>
  );
}
