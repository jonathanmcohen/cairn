import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
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
    </div>
  );
}
