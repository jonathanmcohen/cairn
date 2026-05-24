import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

/**
 * P19 ships only the shell. Concrete "Add connector" flow lands in P20 (Sheets),
 * P21 (Airtable), and P22 (CSV) — each registers an adapter and adds a wizard.
 */
export default async function ConnectorsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect('/login');
  const db = getDb();
  const connectors = await db
    .select()
    .from(schema.databaseConnectors)
    .where(eq(schema.databaseConnectors.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.databaseConnectors.createdAt));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Connectors</h1>
        <Button
          disabled
          title="Adapter wiring lands in v0.7.0 P20 (Sheets) / P21 (Airtable) / P22 (CSV)."
        >
          Add connector
        </Button>
      </header>
      {connectors.length === 0 ? (
        <p className="text-muted-foreground text-sm">No connectors configured.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {connectors.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium">{c.kind}</div>
                <div className="text-muted-foreground text-xs">
                  last synced:{' '}
                  {c.lastSyncedAt ? c.lastSyncedAt.toISOString().slice(0, 16) : 'never'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    c.enabled ? 'bg-secondary text-secondary-foreground' : 'border'
                  }`}
                >
                  {c.enabled ? 'enabled' : 'disabled'}
                </span>
                <Link href={`/settings/connectors/${c.id}/conflicts`} className="text-sm underline">
                  Conflicts
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
