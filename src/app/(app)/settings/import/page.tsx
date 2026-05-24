import { ImportForm } from '@/components/import/import-form';
import { requireRole } from '@/lib/auth/require-role';

export default async function ImportSettingsPage() {
  const ctx = await requireRole('admin');
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Import workspace data</h1>
      <p className="text-muted-foreground text-sm">
        Import a Notion export, a folder of Markdown files, or a Cairn workspace archive into this
        workspace. Pages, databases, and files are remapped to fresh ids; secrets are never
        imported.
      </p>
      <ImportForm workspaceId={ctx.workspaceId} />
    </div>
  );
}
