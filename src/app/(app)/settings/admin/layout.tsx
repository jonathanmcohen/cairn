import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';

// Server-component layout. Gates the whole `/settings/admin` group: anyone
// below `admin` is redirected to the workspace home so the UI never even
// renders. The API routes enforce the gate again — this is just for UX hiding.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  if (!hasMinRole(ctx.role, 'admin')) redirect('/');
  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-6 flex gap-4 text-sm" aria-label="Admin sections">
        <a href="/settings/admin">Members</a>
      </nav>
      {children}
    </div>
  );
}
