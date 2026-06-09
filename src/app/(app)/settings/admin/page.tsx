import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { requireRole } from '@/lib/auth/require-role';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/messages';
import { resolveLocale } from '@/lib/i18n/resolve';
import { createT } from '@/lib/i18n/t';

// v0.9.18 item #5 — /settings/admin gets its OWN landing page. History: the
// old page-level redirect to /settings/admin/audit was dead code because the
// proxy 308'd /settings/admin to /settings/workspace/members first (the v0.8
// hub restructure's EXACT_REDIRECTS entry, removed alongside this page). The
// two layers contradicted each other; the product decision is a real index.
//
// Card hrefs/labels mirror the Admin children in
// src/components/settings/sidebar.tsx (same settings.nav.admin.* keys).
const ADMIN_CHILDREN: Array<{ key: string; href: Route }> = [
  { key: 'settings.nav.admin.audit', href: '/settings/admin/audit' as Route },
  { key: 'settings.nav.admin.members', href: '/settings/admin/users' as Route },
  { key: 'settings.nav.admin.apiKeys', href: '/settings/admin/api-keys' as Route },
  { key: 'settings.nav.admin.webhooks', href: '/settings/admin/webhooks' as Route },
  { key: 'settings.nav.admin.sso', href: '/settings/admin/sso' as Route },
  { key: 'settings.nav.admin.mfa', href: '/settings/admin/mfa' as Route },
  { key: 'settings.nav.admin.encryption', href: '/settings/admin/encryption' as Route },
  { key: 'settings.nav.admin.siem', href: '/settings/admin/siem' as Route },
  { key: 'settings.nav.admin.chatBridge', href: '/settings/admin/chat-bridge' as Route },
  { key: 'settings.nav.admin.federated', href: '/settings/admin/federated' as Route },
  { key: 'settings.nav.admin.upgrade', href: '/settings/admin/upgrade' as Route },
];

export default async function AdminSectionIndex() {
  await requireRole('admin');

  // Server-side t() — mirror the app-shell locale resolution (cookie first,
  // then Accept-Language), same pattern as the favorites/tokens pages.
  const cookieStore = await cookies();
  const hdrs = await headers();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    hdrs.get('accept-language'),
  );
  const t = createT(locale, getMessages(locale));

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: t('settings.nav.admin'), href: '/settings/admin' as Route }}
        page={t('adminLanding.title')}
      />
      <h1 className="mb-1 font-semibold text-xl">{t('adminLanding.title')}</h1>
      <p className="mb-6 text-muted-foreground text-sm">{t('adminLanding.intro')}</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_CHILDREN.map(({ key, href }) => (
          <li key={key}>
            <Link
              href={href}
              className="block rounded-lg border bg-card p-4 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t(key)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
