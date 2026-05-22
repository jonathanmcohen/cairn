import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { NoWorkspace } from '@/components/no-workspace';
import { SearchPalette } from '@/components/search-palette';
import { Sidebar } from '@/components/sidebar';
import { SidebarContent } from '@/components/sidebar-content';
import { SidebarDrawer } from '@/components/sidebar-drawer';
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
    <div className="flex min-h-screen flex-col md:flex-row">
      <KeyboardShortcuts />
      <SearchPalette />
      <Sidebar workspaceId={ctx.workspaceId} />
      <SidebarDrawer>
        <SidebarContent workspaceId={ctx.workspaceId} workspaces={workspaces} />
      </SidebarDrawer>
      <main className="flex-1 p-8">{children}</main>
      <Toaster />
    </div>
  );
}
