import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { NewPageButton } from '@/components/new-page-button';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { getPageTree } from '@/lib/pages/tree';
import { resolveLandingPage } from '@/lib/workspaces/home';

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) return null;
  const db = getDb();

  // Workspace-home: redirect to the configured/first landing page when one exists.
  const landingId = await resolveLandingPage(db, {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (landingId) {
    redirect(`/pages/${landingId}` as Route);
  }

  // Otherwise the empty-state CTA.
  const tree = await getPageTree(db, ctx.workspaceId);
  if (tree.length > 0) {
    // (Shouldn't reach here in practice — resolveLandingPage returns the first
    // page when home_page_id is null. Keep as a defensive branch.)
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-muted-foreground">
          Select a page from the sidebar, or create a new one.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center py-24 text-center">
      <h1 className="text-3xl font-semibold">Your workspace is empty</h1>
      <p className="mt-2 text-muted-foreground">Create your first page to get started.</p>
      <div className="mt-6">
        <NewPageButton />
      </div>
    </div>
  );
}
