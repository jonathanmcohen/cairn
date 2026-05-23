import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { SettingsError, updateWorkspaceSettings } from '@/lib/workspaces/settings';

const Body = z.object({
  name: z.string().min(1).max(120).optional(),
  requireTwofa: z.boolean().optional(),
  homePageId: z.uuid().nullable().optional(),
});

const IdSchema = z.uuid();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    const ctx = await requireRole('admin');
    // Active workspace must match the URL id — otherwise we'd leak existence
    // of cross-workspace ids. 404 (not 403) matches the requirePageAccess
    // convention.
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    const body = Body.parse(await req.json().catch(() => ({})));
    const db = getDb();
    await updateWorkspaceSettings(db, { workspaceId, ...body });
    await recordAudit(db, {
      workspaceId,
      actorUserId: ctx.userId,
      action: 'workspace.settings_changed',
      metadata: { changed: Object.keys(body) },
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof SettingsError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
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
