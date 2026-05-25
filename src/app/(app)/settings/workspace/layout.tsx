import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';

// Server-component layout. Gates the whole `/settings/workspace` group:
// anyone below `admin` is redirected to the workspace home so the UI never
// even renders. The API routes enforce the gate again — this is just for UX
// hiding. The sectioned-hub sidebar lives in `../layout.tsx`.
export default async function WorkspaceSettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  if (!hasMinRole(ctx.role, 'admin')) redirect('/');
  return <>{children}</>;
}
