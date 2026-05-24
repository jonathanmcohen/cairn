import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import type { ConnectorState } from '@/lib/connectors/adapter';
import { decryptAuthConfig } from '@/lib/connectors/auth';
import { getAdapter } from '@/lib/connectors/registry';

const Body = z.object({
  resolution: z.enum(['cairn', 'external', 'manual']),
  manualValue: z.unknown().optional(),
});

type Ctx = { params: Promise<{ connectorId: string; conflictId: string }> };

/**
 * Apply a chosen value to the conflicting Cairn cell, mirror it to the external
 * system via `adapter.applyChanges`, and stamp the conflict as resolved.
 *
 * Body: `{ resolution: 'cairn' | 'external' | 'manual', manualValue?: unknown }`.
 * 409 if already resolved, 404 if either id doesn't belong to the workspace.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { connectorId, conflictId } = await params;
    const body = Body.parse(await req.json());
    const db = getDb();

    const [conn] = await db
      .select()
      .from(schema.databaseConnectors)
      .where(
        and(
          eq(schema.databaseConnectors.id, connectorId),
          eq(schema.databaseConnectors.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1);
    if (!conn) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const [conflict] = await db
      .select()
      .from(schema.connectorConflicts)
      .where(
        and(
          eq(schema.connectorConflicts.id, conflictId),
          eq(schema.connectorConflicts.connectorId, connectorId),
        ),
      )
      .limit(1);
    if (!conflict) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (conflict.resolvedAt)
      return NextResponse.json({ error: 'already resolved' }, { status: 409 });

    const chosen =
      body.resolution === 'cairn'
        ? conflict.cairnValue
        : body.resolution === 'external'
          ? conflict.externalValue
          : body.manualValue;

    if (conflict.rowId && conflict.propertyId) {
      await db
        .insert(schema.dbCells)
        .values({ rowId: conflict.rowId, propertyId: conflict.propertyId, value: chosen })
        .onConflictDoUpdate({
          target: [schema.dbCells.rowId, schema.dbCells.propertyId],
          set: { value: chosen },
        });

      // Push the resolved value to the external side via applyChanges.
      const [map] = await db
        .select()
        .from(schema.connectorRowMap)
        .where(
          and(
            eq(schema.connectorRowMap.connectorId, connectorId),
            eq(schema.connectorRowMap.cairnRowId, conflict.rowId),
          ),
        )
        .limit(1);
      if (map) {
        const adapter = getAdapter(conn.kind as schema.ConnectorKind);
        const state: ConnectorState = {
          connectorId: conn.id,
          authConfig: decryptAuthConfig(conn.authConfig),
          syncConfig: conn.syncConfig,
        };
        await adapter.applyChanges(state, {
          creates: [],
          updates: [{ externalId: map.externalId, cells: { [conflict.propertyId]: chosen } }],
          deletes: [],
        });
      }
    }

    await db
      .update(schema.connectorConflicts)
      .set({ resolvedAt: new Date(), resolution: body.resolution })
      .where(eq(schema.connectorConflicts.id, conflictId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 },
    );
  }
}
