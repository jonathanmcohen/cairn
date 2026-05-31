import { eq } from 'drizzle-orm';
import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { ForwardersView } from './forwarders-view';

export const dynamic = 'force-dynamic';

// Settings-hub home for the SIEM-forwarder admin UI (#132). The standalone
// /admin/siem page predates the settings hub; this surfaces the same backend
// (/api/admin/siem) under the Admin nav so it is actually discoverable. The
// RSC fetches + gates; <ForwardersView/> renders the i18n copy + form.
export default async function SiemSettingsPage() {
  const ctx = await requireRole('admin');
  const forwarders = await getDb()
    .select({
      id: schema.siemForwarders.id,
      kind: schema.siemForwarders.kind,
      name: schema.siemForwarders.name,
      endpoint: schema.siemForwarders.endpoint,
      enabled: schema.siemForwarders.enabled,
    })
    .from(schema.siemForwarders)
    .where(eq(schema.siemForwarders.workspaceId, ctx.workspaceId));

  return (
    <section className="space-y-8">
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="SIEM forwarders"
      />
      <ForwardersView forwarders={forwarders} />
    </section>
  );
}
