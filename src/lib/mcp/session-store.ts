import { randomUUID } from 'node:crypto';
import type { TokenContext } from '@/lib/auth/token';
import { logger } from '@/lib/observability/logger';

/**
 * SSE-fallback session store.
 *
 * Each open SSE stream registers a session keyed by a uuid. POSTs to
 * /api/mcp/messages look up the session to find the `ReadableStream`
 * controller for the matching SSE stream, then push response events onto it.
 *
 * SCOPE: in-memory only. Multi-instance deployments WILL lose session routing
 * — the SSE GET and the POST /messages must hit the same process. Documented
 * in docs/operations.md ("Schedulers + single-instance state" section).
 */
export const SSE_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes idle

export type SseSession = {
  sessionId: string;
  tokenId: string;
  workspaceId: string;
  ctx: TokenContext;
  controller: ReadableStreamDefaultController<Uint8Array>;
  createdAt: number;
  lastSeenAt: number;
};

const sessions: Map<string, SseSession> = new Map();
const enc = new TextEncoder();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSession(
  ctx: TokenContext,
  controller: ReadableStreamDefaultController<Uint8Array>,
  providedSessionId?: string,
): { sessionId: string; session: SseSession } {
  const sessionId =
    providedSessionId && UUID_RE.test(providedSessionId) ? providedSessionId : randomUUID();
  const now = Date.now();
  const session: SseSession = {
    sessionId,
    tokenId: ctx.tokenId,
    workspaceId: ctx.workspaceId,
    ctx,
    controller,
    createdAt: now,
    lastSeenAt: now,
  };
  sessions.set(sessionId, session);
  return { sessionId, session };
}

export function getSession(sessionId: string): SseSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Push a JSON-serializable payload to the SSE stream as a `message` event.
 * Returns true on success, false if the session is unknown.
 */
export function sendToSession(sessionId: string, payload: unknown): boolean {
  const sess = sessions.get(sessionId);
  if (!sess) return false;
  try {
    sess.controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`));
    sess.lastSeenAt = Date.now();
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, sessionId },
      '[mcp-sse] enqueue failed; evicting session',
    );
    closeSession(sessionId);
    return false;
  }
}

export function closeSession(sessionId: string): void {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  try {
    sess.controller.close();
  } catch {
    // best-effort
  }
  sessions.delete(sessionId);
}

/**
 * Evict any session whose `lastSeenAt` is older than `SSE_SESSION_TTL_MS`. The
 * route handler schedules this on a background interval (see route file).
 */
export function sweepExpiredSessions(): number {
  const cutoff = Date.now() - SSE_SESSION_TTL_MS;
  let evicted = 0;
  for (const [id, s] of sessions.entries()) {
    if (s.lastSeenAt < cutoff) {
      try {
        s.controller.close();
      } catch {
        // best-effort
      }
      sessions.delete(id);
      evicted += 1;
    }
  }
  return evicted;
}

/** Test-only: clear all sessions. */
export function resetSessionStore(): void {
  for (const [id, s] of sessions.entries()) {
    try {
      s.controller.close();
    } catch {
      // best-effort
    }
    sessions.delete(id);
  }
}

/** Test-only: expose current size. */
export function sessionCount(): number {
  return sessions.size;
}
