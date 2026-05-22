import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const PatchWebhook = z.object({ active: z.boolean() });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const parsed = PatchWebhook.parse(await req.json());
    // Scope to the active workspace so cross-workspace ids no-op.
    const updated = await getDb()
      .update(schema.webhooks)
      .set({ active: parsed.active })
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.workspaceId, ctx.workspaceId)))
      .returning({ id: schema.webhooks.id, active: schema.webhooks.active });
    if (updated.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ webhook: updated[0] });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    // Deliveries cascade via the FK; scope the delete to the workspace.
    const deleted = await getDb()
      .delete(schema.webhooks)
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.workspaceId, ctx.workspaceId)))
      .returning({ id: schema.webhooks.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
