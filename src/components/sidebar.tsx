import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { appVersion } from '@/lib/version';
import { eq } from 'drizzle-orm';
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
      <nav className="flex-1 p-3">
        <p className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Pages</p>
        <p className="px-2 py-4 text-sm text-muted-foreground">Page list lands in Plan 2.</p>
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
