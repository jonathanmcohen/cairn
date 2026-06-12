import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { type SearchFilters, searchPages } from '@/lib/pages/search';
import { countPendingEmbeddings } from '@/lib/search/embedding-status';
import { federatedSearch } from '@/lib/search/federated';
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

    // v0.9.0 G5 P30 — federated search opt-in flag. When set + caller is
    // admin/owner, federatedSearch ALSO scans non-member workspaces and
    // emits a `search.cross_workspace_admin` audit. Peer fan-out is gated
    // by env (CAIRN_FEDERATION_SHARED_SECRET) and runs unconditionally
    // when configured.
    const includeAll = url.searchParams.get('include_all_workspaces') === 'true';

    // v0.10.2 P18 — "still indexing" indicator. Fail-open: the search itself
    // must never fail because the pending-embeddings count query failed.
    let pendingEmbeddings = 0;
    try {
      pendingEmbeddings = await countPendingEmbeddings(getDb(), ctx.workspaceId);
    } catch (err) {
      console.warn('search: pending-embeddings count failed (returning 0):', err);
    }

    try {
      // Federated path: used when the user explicitly opts in (admin
      // cross-workspace) OR when this instance is configured with a
      // federation secret (peer fan-out always applies). The route only
      // supports 'fts' mode through federation today — semantic/hybrid stay
      // on the direct searchPages path until per-workspace embedding sets
      // can be queried across instances.
      if ((includeAll || process.env.CAIRN_FEDERATION_SHARED_SECRET) && mode === 'fts') {
        const fed = await federatedSearch(getDb(), {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          role: ctx.role,
          query: result.free,
          filters,
          includeAllWorkspaces: includeAll,
        });
        return NextResponse.json({
          results: fed.local,
          peer_results: fed.peer,
          warnings: [...result.warnings, ...expanded.warnings],
          pending_embeddings: pendingEmbeddings,
        });
      }

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
        pending_embeddings: pendingEmbeddings,
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
