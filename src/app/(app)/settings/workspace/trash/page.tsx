import { eq } from 'drizzle-orm';
import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { TrashSettingsForm } from './trash-settings-form';

/**
 * v0.9.0 G2 P13 — Admin-only Trash retention console.
 *
 * Surfaces two controls:
 *   - Retention-days input (0..3650). 0 disables auto-purge.
 *   - "Empty trash now" button (purges every trashed page regardless of age).
 *
 * The settings layout above gates on admin; `requireRole('admin')` here is
 * defense-in-depth so direct deep-links throw a typed 403/401 instead of
 * silently rendering a stale form.
 */
export default async function TrashSettingsPage() {
  const ctx = await requireRole('admin');
  const rows = await getDb()
    .select({ retention: schema.workspaces.trashRetentionDays })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ctx.workspaceId))
    .limit(1);
  const retentionDays = rows[0]?.retention ?? env().CAIRN_TRASH_RETENTION_DAYS;
  const envDefault = env().CAIRN_TRASH_RETENTION_DAYS;

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Trash retention"
      />
      <h1 className="mb-2 text-xl font-semibold">Trash retention</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Trashed pages are kept for this many days before they are permanently deleted by the daily
        purge job. Set to <code>0</code> to disable auto-purge entirely (manual empty-trash still
        works). The global default is <code>{envDefault}</code>.
      </p>
      <TrashSettingsForm initialRetentionDays={retentionDays} envDefault={envDefault} />
    </section>
  );
}
