import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { errToResponse } from '@/lib/databases/route-errors';
import { createView } from '@/lib/databases/views';

type Ctx = { params: Promise<{ databaseId: string }> };

const CreateInput = z.object({
  type: z.enum(['table', 'kanban', 'gallery', 'calendar', 'timeline']),
  name: z.string().min(1).max(100),
  config: z.unknown().optional(),
});

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId } = await params;
    const parsed = CreateInput.parse(await req.json());
    const view = await createView(getDb(), {
      databaseId,
      workspaceId: ctx.workspaceId,
      type: parsed.type,
      name: parsed.name,
      config: parsed.config,
    });
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    return errToResponse(err);
  }
}
