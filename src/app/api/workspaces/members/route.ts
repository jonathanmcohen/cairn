import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { searchWorkspaceMembers } from '@/lib/workspaces/members';

const Query = z.object({ q: z.string().max(200) });

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const url = new URL(req.url);
    const parsed = Query.parse({ q: url.searchParams.get('q') ?? '' });
    const members = await searchWorkspaceMembers(getDb(), {
      workspaceId: ctx.workspaceId,
      query: parsed.q,
      limit: 10,
    });
    return NextResponse.json({ members });
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
