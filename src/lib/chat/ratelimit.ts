/**
 * v0.9.0 G7 P37 — chat-bridge per-workspace token bucket.
 *
 * Single-instance, in-process rate-limit applied by both the slash-command
 * handler and the channel-sync engine. Default 30 messages / 60 seconds per
 * workspace; callers may override via the workspace's
 * `chat_bridge_installs.options.rateLimit` (jsonb) — Task 5/6 consumers pull
 * the override out and pass it down.
 *
 * For multi-instance deployments this would need a shared bucket (Redis); the
 * P36 inbound limiter has the same caveat and is documented in SECURITY.md.
 */

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 30;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export async function checkRateLimit(input: {
  workspaceId: string;
  limit?: number;
}): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const now = Date.now();
  const key = input.workspaceId;
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count += 1;
  return { allowed: true, remaining: limit - b.count, resetAt: b.resetAt };
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}
