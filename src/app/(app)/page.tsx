import { NewPageButton } from '@/components/new-page-button';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { getPageTree } from '@/lib/pages/tree';

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  const tree = await getPageTree(getDb(), ctx.workspaceId);
  if (tree.length > 0) {
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
