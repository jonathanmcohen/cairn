import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { deleteConnector, updateConnectorConfig } from '@/lib/connectors/manage';

const PatchBody = z.object({
  authConfig: z.record(z.string(), z.unknown()).optional(),
  syncConfig: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

type Ctx = { params: Promise<{ connectorId: string }> };

/**
 * Persist a database-connector's config. Body: `{ authConfig?, syncConfig, enabled? }`.
 * `authConfig` is encrypted by the manage helper only when present (Airtable PAT
 * rotate; Sheets/CSV omit it). Admin-gated, workspace-scoped → 404 if the
 * connector isn't in the caller's workspace. This is the endpoint the three
 * config forms in src/components/connectors/* POST to.
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { connectorId } = await params;
    const body = PatchBody.parse(await req.json());
    const updated = await updateConnectorConfig(getDb(), connectorId, ctx.workspaceId, {
      syncConfig: body.syncConfig,
      authConfig: body.authConfig,
      enabled: body.enabled,
    });
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
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

/** Remove a connector (admin-gated, workspace-scoped). Conflicts + row-map cascade via FK. */
export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { connectorId } = await params;
    const removed = await deleteConnector(getDb(), connectorId, ctx.workspaceId);
    if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 },
    );
  }
}
