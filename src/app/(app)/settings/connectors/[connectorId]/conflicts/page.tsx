import { and, eq, isNull } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';
import { ResolveButton } from './resolve-button';

export const dynamic = 'force-dynamic';

export default async function ConflictInboxPage({
  params,
}: {
  params: Promise<{ connectorId: string }>;
}) {
  const { connectorId } = await params;
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  if (!hasMinRole(ctx.role, 'admin')) redirect('/settings/connectors');

  const db = getDb();
  const [connector] = await db
    .select()
    .from(schema.databaseConnectors)
    .where(
      and(
        eq(schema.databaseConnectors.id, connectorId),
        eq(schema.databaseConnectors.workspaceId, ctx.workspaceId),
      ),
    )
    .limit(1);
  if (!connector) notFound();

  const conflicts = await db
    .select()
    .from(schema.connectorConflicts)
    .where(
      and(
        eq(schema.connectorConflicts.connectorId, connectorId),
        isNull(schema.connectorConflicts.resolvedAt),
      ),
    );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Conflicts</h1>
        <p className="text-muted-foreground text-sm">
          {connector.kind} · {conflicts.length} unresolved
        </p>
      </header>
      {conflicts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No unresolved conflicts.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>Row</th>
              <th>Property</th>
              <th>Cairn value</th>
              <th>External value</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-2">
                  <code className="text-xs">{c.rowId?.slice(0, 8) ?? '—'}</code>
                </td>
                <td>
                  <code className="text-xs">{c.propertyId?.slice(0, 8) ?? '—'}</code>
                </td>
                <td>
                  <code className="text-xs">{JSON.stringify(c.cairnValue)}</code>
                </td>
                <td>
                  <code className="text-xs">{JSON.stringify(c.externalValue)}</code>
                </td>
                <td className="flex gap-1 py-2">
                  <ResolveButton connectorId={connectorId} conflictId={c.id} resolution="cairn">
                    Use Cairn
                  </ResolveButton>
                  <ResolveButton connectorId={connectorId} conflictId={c.id} resolution="external">
                    Use External
                  </ResolveButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
