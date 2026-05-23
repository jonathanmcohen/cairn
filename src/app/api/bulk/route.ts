import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import {
  type BulkResult,
  bulkMovePages,
  bulkRestorePages,
  bulkTrashPages,
} from '@/lib/bulk/operations';

const BodySchema = z.object({
  op: z.enum(['trash', 'restore', 'move']),
  ids: z.array(z.uuid()).min(1).max(500),
  params: z.object({ parentId: z.uuid().nullable() }).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!ctx.workspaceId || !ctx.role) {
    return NextResponse.json({ error: 'no workspace' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const db = getDb();
  const base = {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    role: ctx.role,
    ids: parsed.data.ids,
  };
  try {
    let result: BulkResult;
    if (parsed.data.op === 'trash') {
      result = await bulkTrashPages(db, base);
    } else if (parsed.data.op === 'restore') {
      result = await bulkRestorePages(db, base);
    } else {
      result = await bulkMovePages(db, {
        ...base,
        parentId: parsed.data.params?.parentId ?? null,
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    if (msg.startsWith('requires role')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
