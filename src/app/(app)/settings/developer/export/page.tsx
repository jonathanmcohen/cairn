import type { Route } from 'next';
import { ExportForm } from '@/components/export/export-form';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';

export default async function ExportSettingsPage() {
  const ctx = await requireRole('admin');
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Developer', href: '/settings/developer' as Route }}
        page="Export"
      />
      <h1 className="text-2xl font-semibold">Export workspace</h1>
      <p className="text-muted-foreground text-sm">
        Generate a re-importable archive of every page, database, and file in this workspace.
        Secrets (API keys, webhook signatures, TOTP material) are intentionally excluded.
      </p>
      <ExportForm workspaceId={ctx.workspaceId} />
    </div>
  );
}
