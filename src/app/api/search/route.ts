import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { type SearchFilters, searchPages } from '@/lib/pages/search';
import { filtersFromOperators, parseQuery } from '@/lib/search/operators';
import { expandTemplates } from '@/lib/search/operators-template';
import { listTemplates } from '@/lib/search/saved';

const Query = z.object({
  q: z.string().max(500),
});

const SearchModeSchema = z.enum(['fts', 'semantic', 'hybrid']);

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const url = new URL(req.url);
    const parsed = Query.parse({ q: url.searchParams.get('q') ?? '' });

    // 1) Template expansion: @name → expansion string (per-user templates).
    const templates = await listTemplates(getDb(), {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    const expanded = expandTemplates(
      parsed.q,
      templates.map((t) => ({ name: t.templateName, expansion: t.expansion })),
    );

    // 2) Operator parse on the expanded text.
    const result = parseQuery(expanded.text);

    // 3) Operator → filters projection (uuid-form `from:` already handled).
    const opFilters = filtersFromOperators(result.ops);

    // 4) Resolve `from:<identifier>` against users.email when not already a
    //    uuid. (The users table has no `username` column today; email is the
    //    stable user-visible identifier.) Cross-workspace authors are still
    //    fine because the search route already scopes by workspace_id.
    if (!opFilters.author) {
      for (const op of result.ops) {
        if (op.key !== 'from') continue;
        const [row] = await getDb()
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, op.value))
          .limit(1);
        if (row) {
          opFilters.author = row.id;
          break;
        }
      }
    }

    // 5) URL-param filters (preserve existing behavior; win on conflict).
    const filters: SearchFilters = { ...opFilters };
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

    const modeParam = url.searchParams.get('mode') ?? 'fts';
    const modeResult = SearchModeSchema.safeParse(modeParam);
    if (!modeResult.success) {
      return NextResponse.json({ error: 'unknown mode' }, { status: 400 });
    }
    const mode = modeResult.data;

    try {
      const results = await searchPages(getDb(), {
        workspaceId: ctx.workspaceId,
        query: result.free,
        limit: 20,
        filters,
        mode,
      });
      return NextResponse.json({
        results,
        warnings: [...result.warnings, ...expanded.warnings],
      });
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
