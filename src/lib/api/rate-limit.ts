import { ZodError } from 'zod';
import type { AuthContext } from '@/lib/auth/require-role';
import { HttpError } from '@/lib/auth/require-role';
import { requireApiAuth } from './auth';

/**
 * In-memory per-key token bucket. SINGLE-INSTANCE ONLY: the Map lives in the
 * process heap, so buckets reset on restart and are NOT shared across replicas.
 * Documented homelab ceiling (§2.2 / §8) — not Redis-backed. For a distributed
 * deployment this must be swapped for a shared store.
 */
type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();

export type RateLimitOpts = { capacity: number; refillPerSec: number };
const DEFAULT_LIMIT: RateLimitOpts = { capacity: 60, refillPerSec: 1 }; // ~60 req burst, 1/s steady

/** Returns true and consumes a token if available; false if the bucket is empty. */
export function takeToken(keyId: string, opts: RateLimitOpts = DEFAULT_LIMIT): boolean {
  const now = Date.now();
  let b = buckets.get(keyId);
  if (!b) {
    b = { tokens: opts.capacity, lastRefill: now };
    buckets.set(keyId, b);
  }
  // Refill based on elapsed time, capped at capacity.
  const elapsedSec = (now - b.lastRefill) / 1000;
  if (elapsedSec > 0 && opts.refillPerSec > 0) {
    b.tokens = Math.min(opts.capacity, b.tokens + elapsedSec * opts.refillPerSec);
    b.lastRefill = now;
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}

/** Test-only: clear all buckets between cases. */
export function __resetBuckets(): void {
  buckets.clear();
}

function errorBody(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

type ApiHandler = (req: Request, ctx: AuthContext) => Promise<Response> | Response;

/**
 * Wrap an /api/v1 handler: authenticate the bearer key → rate-limit per key →
 * invoke the handler with the AuthContext → shape ALL errors uniformly as
 * { error: { code, message } }.
 */
export function withApiKey(handler: ApiHandler, opts: RateLimitOpts = DEFAULT_LIMIT) {
  return async (req: Request, _routeCtx?: unknown): Promise<Response> => {
    let ctx: AuthContext;
    try {
      ctx = await requireApiAuth(req);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 401;
      return errorBody('unauthorized', err instanceof Error ? err.message : 'unauthorized', status);
    }

    // Bucket keyed by workspace+role+user (a stand-in for the key id; the key
    // row's id is not surfaced by AuthContext, so we derive a stable id).
    const bucketKey = `${ctx.workspaceId}:${ctx.userId}:${ctx.role}`;
    if (!takeToken(bucketKey, opts)) {
      return errorBody('rate_limited', 'Rate limit exceeded for this API key', 429);
    }

    try {
      // Pass routeCtx (Next dynamic params) through on the Request via closure;
      // handlers that need params read them from routeCtx via a thin adapter
      // (see Task 5/6 route wiring).
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        const code = err.status === 404 ? 'not_found' : err.status === 403 ? 'forbidden' : 'error';
        return errorBody(code, err.message, err.status);
      }
      if (err instanceof ZodError) {
        return errorBody('validation', 'Invalid request body', 400);
      }
      return errorBody('internal', 'Internal error', 500);
    }
  };
}
