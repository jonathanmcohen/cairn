/**
 * v0.9.0 G4 P23 — /my-tasks server component.
 *
 * Aggregates every taskItem across pages the user can read (v0.7 ACL), filters
 * by status / dueBy / workspace, and renders the client TasksTable for
 * interactive toggling + chip filters.
 */
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/require-role';
import { listMyTasks } from '@/lib/tasks/aggregate';
import { TasksTable } from './tasks-table';

type SearchParams = Record<string, string | string[] | undefined>;

type Status = 'open' | 'done' | 'all';

function parseStatus(s: string | string[] | undefined): Status {
  if (s === 'done' || s === 'all') return s;
  return 'open';
}

function parseString(s: string | string[] | undefined): string | undefined {
  if (typeof s === 'string' && s.length > 0) return s;
  return undefined;
}

export const dynamic = 'force-dynamic';

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactNode> {
  const ctx = await getAuthContext();
  if (!ctx?.userId) redirect('/login');

  const sp = await searchParams;
  const status = parseStatus(sp.status);
  const workspaceId = parseString(sp.workspace);
  const dueRaw = parseString(sp.due);
  const dueBy = dueRaw ? new Date(`${dueRaw}T23:59:59Z`) : undefined;

  const tasks = await listMyTasks(ctx.userId, {
    workspaceId,
    status,
    dueBy: dueBy && !Number.isNaN(dueBy.getTime()) ? dueBy : undefined,
  });

  // Serialize Date → ISO string for the client boundary.
  const initialTasks = tasks.map((t) => ({
    pageId: t.pageId,
    workspaceId: t.workspaceId,
    blockId: t.blockId,
    text: t.text,
    checked: t.checked,
    dueAtIso: t.dueAt ? t.dueAt.toISOString() : null,
    pageTitle: t.pageTitle,
    pageIcon: t.pageIcon,
  }));

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="font-semibold text-2xl">My tasks</h1>
        <p className="text-muted-foreground text-sm">
          Every task assigned to you or where you were @mentioned, across every workspace you can
          read.
        </p>
      </header>
      <TasksTable initialTasks={initialTasks} initialStatus={status} initialDue={dueRaw ?? ''} />
    </main>
  );
}
