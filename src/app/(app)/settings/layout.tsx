import type { ReactNode } from 'react';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  const isAdmin = ctx?.role ? hasMinRole(ctx.role, 'admin') : false;
  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8">
      <SettingsSidebar isAdmin={isAdmin} />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
