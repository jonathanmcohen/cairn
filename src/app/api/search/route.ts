import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { searchPages } from '@/lib/pages/search';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const Query = z.object({
  q: z.string().max(200),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const url = new URL(req.url);
    const parsed = Query.parse({ q: url.searchParams.get('q') ?? '' });
    const results = await searchPages(getDb(), {
      workspaceId: ctx.workspaceId,
      query: parsed.q,
      limit: 20,
    });
    return NextResponse.json({ results });
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
