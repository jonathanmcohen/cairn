import { timingSafeEqual } from 'node:crypto';
import { metricsRegistry } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BEARER = /^Bearer\s+(\S+)$/i;

/** Constant-time string compare that never short-circuits on length. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * GET /metrics — Prometheus exposition.
 *  - CAIRN_METRICS_TOKEN unset  → 404 (off by default; do not advertise the endpoint).
 *  - set, bearer missing/wrong  → 401 (timing-safe compare).
 *  - set, bearer correct        → 200 text/plain exposition.
 * Read process.env directly (not cached env()) so the toggle is per-request.
 */
export async function GET(req: Request): Promise<Response> {
  const expected = process.env.CAIRN_METRICS_TOKEN;
  if (!expected) {
    return new Response('Not found', { status: 404 });
  }
  const header = req.headers.get('authorization') ?? '';
  const match = BEARER.exec(header.trim());
  const provided = match?.[1];
  if (!provided || !tokenMatches(provided, expected)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="metrics"' },
    });
  }
  const registry = metricsRegistry();
  const body = await registry.metrics();
  return new Response(body, {
    status: 200,
    headers: { 'content-type': registry.contentType },
  });
}
