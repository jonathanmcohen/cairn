import { ExportForm } from '@/components/export/export-form';
import { requireRole } from '@/lib/auth/require-role';

export default async function ExportSettingsPage() {
  const ctx = await requireRole('admin');
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Export workspace</h1>
      <p className="text-muted-foreground text-sm">
        Generate a re-importable archive of every page, database, and file in this workspace.
        Secrets (API keys, webhook signatures, TOTP material) are intentionally excluded.
      </p>
      <ExportForm workspaceId={ctx.workspaceId} />
    </div>
  );
}
