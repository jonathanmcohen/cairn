/**
 * v0.9.0 G3 P21 — GET /api/citations/lookup
 *
 * Read-only DOI / PubMed citation lookup. The handler validates an xor
 * between `doi=` and `pubmed=` query params, calls the matching server-side
 * fetcher in `lib/citations/lookup`, and returns:
 *
 *   { meta: CitationMeta, formatted: { apa, mla, chicago } }
 *
 * Auth: any signed-in session (Auth.js `auth()` cookie or JWT). The route
 * deliberately surfaces only a generic 400/502 on validation/upstream errors
 * and never proxies the upstream response body — Crossref/eUtils payloads are
 * normalized through CitationMeta first.
 */

import { z } from 'zod';
import { auth } from '@/lib/auth/config';
import { formatApa, formatChicago, formatMla } from '@/lib/citations/format';
import { lookupDoi, lookupPubmed } from '@/lib/citations/lookup';
import type { CitationMeta, FormattedCitation } from '@/lib/citations/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const QuerySchema = z
  .object({
    doi: z.string().min(1).optional(),
    pubmed: z.string().regex(/^\d+$/).optional(),
  })
  .refine(
    (v) => Boolean(v.doi) !== Boolean(v.pubmed),
    'exactly one of doi, pubmed must be supplied',
  );

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    doi: url.searchParams.get('doi') ?? undefined,
    pubmed: url.searchParams.get('pubmed') ?? undefined,
  });
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid query' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let meta: CitationMeta;
  try {
    meta = parsed.data.doi
      ? await lookupDoi(parsed.data.doi)
      : await lookupPubmed(parsed.data.pubmed as string);
  } catch (err) {
    // Log raw upstream error server-side; respond generically.
    console.error('citation lookup failed', (err as Error).message);
    return new Response(JSON.stringify({ error: 'lookup failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const formatted: FormattedCitation = {
    apa: formatApa(meta),
    mla: formatMla(meta),
    chicago: formatChicago(meta),
  };
  return new Response(JSON.stringify({ meta, formatted }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
