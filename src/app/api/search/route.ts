import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { type SearchFilters, searchPages } from '@/lib/pages/search';

const Query = z.object({
  q: z.string().max(200),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const url = new URL(req.url);
    const parsed = Query.parse({ q: url.searchParams.get('q') ?? '' });

    const filters: SearchFilters = {};
    const author = url.searchParams.get('author');
    if (author) filters.author = author;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from || to) {
      const dr: { from?: string; to?: string } = {};
      if (from) dr.from = from;
      if (to) dr.to = to;
      filters.dateRange = dr;
    }
    const types = url.searchParams.get('types');
    if (types) {
      const parts = types
        .split(',')
        .filter((t): t is 'page' | 'db_row' => t === 'page' || t === 'db_row');
      if (parts.length > 0) filters.types = parts;
    }
    const scopeDatabaseId = url.searchParams.get('scopeDatabaseId');
    if (scopeDatabaseId) filters.scopeDatabaseId = scopeDatabaseId;

    try {
      const results = await searchPages(getDb(), {
        workspaceId: ctx.workspaceId,
        query: parsed.q,
        limit: 20,
        filters,
      });
      return NextResponse.json({ results });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'invalid' },
        { status: 400 },
      );
    }
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
