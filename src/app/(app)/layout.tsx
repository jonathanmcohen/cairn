import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { NoWorkspace } from '@/components/no-workspace';
import { SearchPalette } from '@/components/search-palette';
import { Sidebar } from '@/components/sidebar';
import { getAuthContext } from '@/lib/auth/require-role';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  if (!ctx.workspaceId) {
    return <NoWorkspace />;
  }
  return (
    <div className="flex min-h-screen">
      <KeyboardShortcuts />
      <SearchPalette />
      <Sidebar workspaceId={ctx.workspaceId} />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
