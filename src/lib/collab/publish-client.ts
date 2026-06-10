import { logger } from '@/lib/observability/logger';

/**
 * Best-effort client that pushes a REST-PATCH content write into the live Yjs
 * doc held by the standalone collab process (v0.9.15 #A3).
 *
 * WHY: while an editor session holds the Y.Doc open in Hocuspocus,
 * collab/server.ts#materialize() overwrites pages.content with the live Yjs
 * state on the next debounce/disconnect — silently losing a REST PATCH content
 * write on hard reload. This notifies the collab process so it can apply the
 * new content to the open doc (a no-op if no session is open, since the DB
 * write already persisted).
 *
 * CONTRACT:
 *   - FIRE-AND-FORGET / FAIL-OPEN. The DB write is already committed before this
 *     runs; if the collab process is unreachable, mis-secret, or returns an
 *     error, we log at warn and return. We NEVER throw into the PATCH path —
 *     breaking saves to chase a best-effort sync would be a strictly worse bug.
 *   - When CAIRN_COLLAB_INTERNAL_URL is unset, the feature is OFF and this no-ops
 *     immediately (single-process / no-collab deployments, and the test default).
 *
 * Auth: the same AUTH_SECRET the collab WS handshake already uses, sent as a
 * bearer token over the internal-only HTTP endpoint. NEVER logged.
 */
/**
 * v0.9.19 A4 (#A3) — is the REST→Yjs publish bridge configured? True only when
 * BOTH `CAIRN_COLLAB_INTERNAL_URL` (where to push) and `AUTH_SECRET` (the
 * bearer both sides compare) are present — exactly the gate
 * `publishContentToCollab` applies before doing any work. Surfaced so the boot
 * sequence and the admin upgrade page can warn when a deployment runs with the
 * bridge silently OFF (e.g. an old docker-compose missing the env var) — the
 * v0.9.18 live miss where a REST PATCH never reached the open editor. Reads
 * `process.env` directly (never the cached `env()`) so tests can toggle it.
 */
export function isCollabBridgeConfigured(): boolean {
  return Boolean(process.env.CAIRN_COLLAB_INTERNAL_URL && process.env.AUTH_SECRET);
}

export async function publishContentToCollab(input: {
  pageId: string;
  content: unknown;
}): Promise<void> {
  const baseUrl = process.env.CAIRN_COLLAB_INTERNAL_URL;
  if (!baseUrl) return; // feature disabled / single-process deploy

  const secret = process.env.AUTH_SECRET;
  if (!secret) return; // cannot authenticate; treat as disabled

  const url = `${baseUrl.replace(/\/$/, '')}/internal/pages/${encodeURIComponent(input.pageId)}/replace`;
  try {
    // Bound the call so a hung collab process can't stall the request thread.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ content: input.content }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    // 204 = applied to a live doc; 200 = applied; 404 = doc not open (no-op, the
    // DB write stands). Anything else is logged but never thrown.
    if (!res.ok && res.status !== 404) {
      logger.warn(
        { pageId: input.pageId, status: res.status },
        'publishContentToCollab: collab endpoint returned non-OK (content still persisted in DB)',
      );
    }
  } catch (err) {
    logger.warn(
      { err, pageId: input.pageId },
      'publishContentToCollab: collab unreachable (content still persisted in DB)',
    );
  }
}
