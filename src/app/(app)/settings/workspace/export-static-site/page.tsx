import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';
import { ExportStaticSiteForm } from './export-static-site-form';

/**
 * v0.9.0 G7 P34 — Static-site export admin console. Workspace admins generate
 * a buildable MkDocs project (ZIP) covering every non-deleted page in the
 * active workspace. The `/settings/workspace` layout already gates on admin;
 * `requireRole('admin')` is repeated for defense-in-depth.
 */
export default async function ExportStaticSitePage() {
  const ctx = await requireRole('admin');
  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Static-site export"
      />
      <h1 className="mb-2 text-xl font-semibold">Static-site export</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Generate a buildable static-site project from this workspace. The download is a ZIP archive
        — unpack it, then run <code>mkdocs serve</code> in the unpacked folder to preview the site.
        Workspaces containing any end-to-end-encrypted page cannot be exported.
      </p>
      <ExportStaticSiteForm workspaceId={ctx.workspaceId} />
    </section>
  );
}
