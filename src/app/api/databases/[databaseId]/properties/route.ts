import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { createProperty } from '@/lib/databases/properties';
import { errToResponse } from '@/lib/databases/route-errors';

type Ctx = { params: Promise<{ databaseId: string }> };

const CreateInput = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url']),
  config: z.unknown().optional(),
});

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId } = await params;
    const parsed = CreateInput.parse(await req.json());
    const prop = await createProperty(getDb(), {
      databaseId,
      workspaceId: ctx.workspaceId,
      name: parsed.name,
      type: parsed.type,
      config: parsed.config,
    });
    return NextResponse.json(prop, { status: 201 });
  } catch (err) {
    return errToResponse(err);
  }
}
