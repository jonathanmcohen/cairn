import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { appVersion } from '@/lib/version';
import { eq } from 'drizzle-orm';
import { NewPageButton } from './new-page-button';
import { SidebarTree } from './sidebar-tree';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';

export async function Sidebar({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card text-card-foreground">
      <div className="flex items-center justify-between border-b p-4">
        <div className="font-semibold">{ws?.name ?? 'Cairn'}</div>
        <ThemeToggle />
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pages</p>
          <NewPageButton />
        </div>
        <SidebarTree workspaceId={workspaceId} />
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <form action="/api/auth/signout" method="post">
          <Button variant="ghost" size="sm" className="w-full justify-start" type="submit">
            Sign out
          </Button>
        </form>
        <div className="mt-2 text-center">v{appVersion()}</div>
      </div>
    </aside>
  );
}
