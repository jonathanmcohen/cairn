import type { ReactNode } from 'react';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  const isAdmin = ctx?.role ? hasMinRole(ctx.role, 'admin') : false;
  // The E2E-encryption settings child is only reachable when the build-time
  // flag is on; mirror the server gate so the nav never points at a 404 (G14).
  const e2eEnabled = env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION;
  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8">
      <SettingsSidebar isAdmin={isAdmin} e2eEnabled={e2eEnabled} />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
