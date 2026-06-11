import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { deleteSlashCommand, SlashCommandError } from '@/lib/slash-commands/manage';

const IdSchema = z.uuid();

/**
 * v0.10.0 F2 — delete a custom slash command (admin/owner). 404 when the URL
 * workspace id is not the caller's ACTIVE workspace, and when the command id
 * doesn't exist in that workspace (no existence leak either way — the brand
 * route convention).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; commandId: string }> },
): Promise<Response> {
  try {
    const { id, commandId } = await params;
    const workspaceId = IdSchema.parse(id);
    const command = IdSchema.parse(commandId);
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    await deleteSlashCommand(getDb(), {
      workspaceId,
      actorUserId: ctx.userId,
      commandId: command,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SlashCommandError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
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
