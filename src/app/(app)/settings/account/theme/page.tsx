import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { TocSidebarToggle } from '@/components/settings/toc-sidebar-toggle';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { getThemePrefs } from '@/lib/themes/prefs';
import { ThemeForm } from './theme-form';

export default async function ThemePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  const prefs = await getThemePrefs(getDb(), ctx.userId);
  return (
    <div>
      <SettingsBreadcrumb
        section={{ label: 'Account', href: '/settings/account' as Route }}
        page="Theme"
      />
      <h1 className="mb-2 text-2xl font-semibold">Theme</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Accent color, font family, and page width. Applies to your view of every page, including
        published pages you author.
      </p>
      <ThemeForm initial={prefs} />
      {/* v0.9.0 G5 P28 — per-device TOC sidebar toggle. Lives alongside the
          theme prefs because both are "viewer chrome" knobs. Persisted via
          localStorage + a same-name cookie so the page-route RSC can read it
          without a DB round-trip. */}
      <section className="mt-10 space-y-3 border-t pt-6">
        <h2 className="text-sm font-semibold">Editor</h2>
        <TocSidebarToggle />
      </section>
    </div>
  );
}
