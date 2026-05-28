import { asc, eq } from 'drizzle-orm';
import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { SpacesManager } from './spaces-manager';

/**
 * Admin-only Spaces console. The layout above this route already gates on
 * `admin`; `requireRole('admin')` is repeated here for defense-in-depth + so
 * direct deep-links return a typed `WorkspaceContext`.
 */
export default async function SpacesAdminPage() {
  const ctx = await requireRole('admin');
  const rows = await getDb()
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      slug: schema.spaces.slug,
      icon: schema.spaces.icon,
      position: schema.spaces.position,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.workspaceId, ctx.workspaceId))
    .orderBy(asc(schema.spaces.position), asc(schema.spaces.name));

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="Spaces"
      />
      <h1 className="mb-4 text-xl font-semibold">Spaces</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Spaces group pages inside this workspace. Each space has its own membership and role chain —
        workspace admins always have full access; other members see only the public spaces plus the
        private spaces they belong to.
      </p>
      <SpacesManager spaces={rows} />
    </section>
  );
}
