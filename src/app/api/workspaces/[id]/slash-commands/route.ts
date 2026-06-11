import { inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import {
  createSlashCommand,
  extractTemplateInsertContent,
  listSlashCommands,
  SlashCommandError,
  type SlashCommandErrorCode,
} from '@/lib/slash-commands/manage';

const IdSchema = z.uuid();

const CreateBody = z.object({
  trigger: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  templateId: z.uuid(),
});

/**
 * v0.10.0 F2 — workspace custom slash commands.
 *
 * GET: any member (viewer+) — the editor's slash menu needs the list (plus
 * each command's insertable content, resolved server-side from the template
 * payload so the client never parses payload shapes). POST: admin/owner —
 * slash commands are workspace-wide settings, managed like the rest of the
 * workspace console (brand/pinned-pages precedent), even though templates
 * themselves are editor-creatable. Both 404 when the URL id is not the
 * caller's ACTIVE workspace — the brand route's existence-hiding convention.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    const ctx = await requireRole('viewer');
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    const db = getDb();
    const commands = await listSlashCommands(db, workspaceId);
    // Join the insertable content in (root-page doc nodes). Commands per
    // workspace are few; templates are immutable snapshots, so this is safe
    // to cache client-side until the next editor mount.
    const payloads =
      commands.length === 0
        ? []
        : await db
            .select({ id: schema.templates.id, payload: schema.templates.payload })
            .from(schema.templates)
            .where(
              inArray(
                schema.templates.id,
                commands.map((c) => c.templateId),
              ),
            );
    const payloadById = new Map(payloads.map((p) => [p.id, p.payload]));
    return NextResponse.json({
      commands: commands.map((c) => ({
        id: c.id,
        trigger: c.trigger,
        label: c.label,
        templateId: c.templateId,
        templateName: c.templateName,
        enabled: c.enabled,
        content: extractTemplateInsertContent(payloadById.get(c.templateId)),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    const body = CreateBody.parse(await req.json().catch(() => ({})));
    const command = await createSlashCommand(getDb(), {
      workspaceId,
      actorUserId: ctx.userId,
      trigger: body.trigger,
      label: body.label,
      templateId: body.templateId,
    });
    return NextResponse.json({ command }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** SlashCommandError codes that are caller mistakes (400), not missing rows. */
const BAD_REQUEST_CODES: ReadonlySet<SlashCommandErrorCode> = new Set([
  'INVALID_TRIGGER',
  'BUILTIN_TRIGGER',
  'DUPLICATE_TRIGGER',
  'TEMPLATE_NOT_INSERTABLE',
]);

function errorResponse(err: unknown): Response {
  if (err instanceof SlashCommandError) {
    const status = BAD_REQUEST_CODES.has(err.code) ? 400 : 404;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
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
