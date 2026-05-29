import { eq } from 'drizzle-orm';
import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { searchWorkspacePages } from '@/lib/workspaces/pages';
import { SettingsForm } from './settings-form';

export default async function AdminSettingsPage() {
  const ctx = await requireRole('admin');
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ctx.workspaceId));
  if (!row) {
    throw new Error('workspace missing');
  }
  // Cap the picker at a reasonable number; a workspace with thousands of pages
  // would want a search-as-you-type picker (out of scope for P17).
  const pages = await searchWorkspacePages(db, {
    workspaceId: ctx.workspaceId,
    query: '',
    limit: 100,
  });
  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page="General"
      />
      <h1 className="mb-4 text-xl font-semibold">General</h1>
      <SettingsForm
        workspaceId={ctx.workspaceId}
        initial={{
          name: row.name,
          requireTwofa: row.requireTwofa,
          homePageId: row.homePageId,
        }}
        pages={pages.map((p) => ({ id: p.id, title: p.title }))}
        twofaEnforcementAvailable={env().CAIRN_ENFORCE_2FA}
      />
    </section>
  );
}
