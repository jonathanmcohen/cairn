import { Sidebar } from '@/components/sidebar';
import { getAuthContext } from '@/lib/auth/require-role';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  return (
    <div className="flex min-h-screen">
      <Sidebar workspaceId={ctx.workspaceId} />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
