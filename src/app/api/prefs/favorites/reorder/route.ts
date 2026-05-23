import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { reorderFavorites } from '@/lib/prefs/user-page-prefs';

const ReorderInput = z.object({ orderedPageIds: z.array(z.uuid()) });

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { orderedPageIds } = ReorderInput.parse(await req.json().catch(() => ({})));
    await reorderFavorites(getDb(), {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      orderedPageIds,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
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
