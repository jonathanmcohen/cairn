import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LiveRegionProvider } from '@/components/a11y/live-region';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NoWorkspace } from '@/components/no-workspace';
import { OfflineProvider } from '@/components/pwa/offline-context';
import { OfflineIndicator } from '@/components/pwa/offline-indicator';
import { RegisterSw } from '@/components/pwa/register-sw';
import { SearchPalette } from '@/components/search-palette';
import { ShortcutDispatcher } from '@/components/shortcuts/dispatcher';
import { ShortcutSheet } from '@/components/shortcuts/sheet';
import { Sidebar } from '@/components/sidebar';
import { SidebarContent } from '@/components/sidebar-content';
import { SidebarDrawer } from '@/components/sidebar-drawer';
import { SkipLink } from '@/components/skip-link';
import { Toaster } from '@/components/ui/sonner';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listUserWorkspaces } from '@/lib/workspaces/list';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  if (!ctx.workspaceId) {
    return <NoWorkspace />;
  }
  const workspaces = await listUserWorkspaces(getDb(), ctx.userId);
  return (
    <OfflineProvider>
      <LiveRegionProvider>
        <ShortcutDispatcher>
          <SkipLink />
          <div className="flex min-h-screen flex-col md:flex-row">
            <RegisterSw />
            <SearchPalette />
            <ShortcutSheet />
            <Sidebar workspaceId={ctx.workspaceId} />
            <SidebarDrawer>
              <SidebarContent workspaceId={ctx.workspaceId} workspaces={workspaces} />
            </SidebarDrawer>
            <main id="main-content" className="flex-1 p-8">
              <div className="mb-2 flex items-center justify-end gap-4">
                <LocaleSwitcher />
                <OfflineIndicator />
              </div>
              {children}
            </main>
            <Toaster />
          </div>
        </ShortcutDispatcher>
      </LiveRegionProvider>
    </OfflineProvider>
  );
}
