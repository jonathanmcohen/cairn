import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createSpace } from '@/lib/spaces/crud';
import { listVisibleSpaces } from '@/lib/spaces/list';

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be kebab-case lowercase'),
  icon: z.string().max(8).optional(),
  parentSpaceId: z.uuid().optional(),
  position: z.coerce.number().int().nonnegative().optional(),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const spaces = await listVisibleSpaces(getDb(), ctx.workspaceId, ctx.userId);
    return NextResponse.json({ spaces }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const result = await createSpace(getDb(), {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      ...parsed.data,
    });
    if (!result.ok) {
      if (result.code === 'duplicate_slug') {
        return NextResponse.json({ error: 'duplicate_slug' }, { status: 409 });
      }
      return NextResponse.json({ error: result.code }, { status: 400 });
    }
    return NextResponse.json(result.space, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): Response {
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
