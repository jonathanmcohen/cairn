import type { Route } from 'next';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { getWorkspaceBrand } from '@/lib/workspaces/brand';
import { searchWorkspacePages } from '@/lib/workspaces/pages';
import { loadWorkspaceGeneralSettings } from '@/lib/workspaces/settings';
import { BrandSettings } from './brand-settings';
import { SettingsForm } from './settings-form';

export default async function AdminSettingsPage() {
  const ctx = await requireRole('admin');
  const db = getDb();
  // #1 — narrowed projection: read ONLY the fields this page renders so a
  // lagging unrelated column on a stale deploy can't 42703 the whole page.
  const row = await loadWorkspaceGeneralSettings(db, ctx.workspaceId);
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
  // v0.10.0 F1 — brand card data (logo signed URL + stored color).
  const brand = await getWorkspaceBrand(db, ctx.workspaceId, { secret: env().AUTH_SECRET });
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
          icon: row.icon,
        }}
        pages={pages.map((p) => ({ id: p.id, title: p.title }))}
        twofaEnforcementAvailable={env().CAIRN_ENFORCE_2FA}
      />
      <BrandSettings
        workspaceId={ctx.workspaceId}
        initial={{
          logoFileId: brand.logoFileId,
          logoUrl: brand.logoUrl,
          primaryColor: brand.primaryColor,
        }}
      />
    </section>
  );
}
