import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createDatabase } from '@/lib/databases/create';

const CreateInput = z.object({
  pageId: z.uuid(),
  name: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const parsed = CreateInput.parse(await req.json());
    const database = await createDatabase(getDb(), {
      workspaceId: ctx.workspaceId,
      pageId: parsed.pageId,
      createdBy: ctx.userId,
      name: parsed.name,
    });
    return NextResponse.json(database, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    const msg = err instanceof Error ? err.message : 'unknown';
    if (/page.*workspace/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
