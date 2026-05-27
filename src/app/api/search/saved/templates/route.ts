import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createTemplate, deleteTemplate, listTemplates } from '@/lib/search/saved';

const CreateBody = z.object({
  templateName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'template name must be alphanumeric / underscore / hyphen'),
  expansion: z.string().min(1).max(500),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const list = await listTemplates(getDb(), {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    return NextResponse.json({ templates: list });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const body = CreateBody.parse(await req.json());
    // Refuse expansions that contain `@` so we never insert a nested template
    // (parser refuses to expand them at read time; refusing at write time
    // surfaces the error earlier).
    if (body.expansion.includes('@')) {
      return NextResponse.json(
        { error: 'expansion may not contain @ (no nested templates)' },
        { status: 400 },
      );
    }
    const t = await createTemplate(getDb(), {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      templateName: body.templateName,
      expansion: body.expansion,
    });
    return NextResponse.json({ template: t }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'failed to create template' }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await deleteTemplate(getDb(), { id, userId: ctx.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'template not found' }, { status: 404 });
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'unknown';
  return NextResponse.json({ error: message }, { status: 500 });
}
