import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/messages';
import { resolveLocale } from '@/lib/i18n/resolve';
import { ExportStaticSiteForm } from './export-static-site-form';

/**
 * v0.9.0 G7 P34 — workspace Export admin console. Workspace admins generate
 * a buildable MkDocs project (ZIP) covering every non-deleted page in the
 * active workspace. The `/settings/workspace` layout already gates on admin;
 * `requireRole('admin')` is repeated for defense-in-depth.
 *
 * v0.9.9 C6 (#187) — the nav label, breadcrumb crumb, and <h1> all read the
 * single localized "Export" term (workspace.export.heading) so the surface no
 * longer shows three different names for one page. Server-side locale
 * resolution mirrors the app shell (see src/app/layout.tsx).
 */
export default async function ExportStaticSitePage() {
  const ctx = await requireRole('admin');
  const cookieStore = await cookies();
  const hdrs = await headers();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, hdrs.get('accept-language'));
  const m = getMessages(locale);
  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Workspace', href: '/settings/workspace' as Route }}
        page={m['workspace.export.heading'] ?? 'Export'}
      />
      <h1 className="mb-2 text-xl font-semibold">{m['workspace.export.heading']}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{m['workspace.export.subtitle']}</p>
      <ExportStaticSiteForm workspaceId={ctx.workspaceId} />
    </section>
  );
}
