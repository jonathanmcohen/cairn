import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createPage } from '@/lib/pages/create';
import { maybePurge } from '@/lib/pages/maybe-purge';

const CreateInput = z.object({
  parentId: z.uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    maybePurge();
    const ctx = await requireRole('editor');
    const parsed = CreateInput.parse(await req.json().catch(() => ({})));
    const page = await createPage(getDb(), {
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      parentId: parsed.parentId,
      title: parsed.title,
      icon: parsed.icon ?? null,
    });
    return NextResponse.json(page, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/workspace/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
