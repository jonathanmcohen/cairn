import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listWorkspacePins } from '@/lib/pins/list';
import { PinnedManager } from './pinned-manager';

/**
 * v0.9.0 G2 P12 — Admin-only "Pinned pages" console. Curates the workspace
 * Pinned section that appears at the top of the sidebar for every member.
 *
 * Settings layout above already gates on admin; `requireRole('admin')` is
 * repeated for defense-in-depth + so direct deep-links throw a typed 403/401.
 */
export default async function PinnedPagesAdminPage() {
  const ctx = await requireRole('admin');
  const pins = await listWorkspacePins(getDb(), ctx.workspaceId);

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Pinned pages"
      />
      <h1 className="mb-2 text-xl font-semibold">Pinned pages</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Pinned pages appear at the top of the sidebar for every member of this workspace, above each
        user&apos;s personal favorites. Drag to reorder.
      </p>
      <PinnedManager initial={pins} />
    </section>
  );
}
