import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hocuspocus } from '@hocuspocus/server';
import { applyProseJsonToFragment } from '../src/lib/collab/apply-prose.js';

/**
 * v0.9.15 #A3 — internal content-replace endpoint for the standalone collab
 * process. When the Next app PATCHes pages.content while a collab session holds
 * the Y.Doc open, it POSTs the new ProseMirror JSON here so we can apply it to
 * the LIVE doc — otherwise the next materialize() flush would clobber the API
 * write on hard reload. Authenticated with the same AUTH_SECRET as the WS
 * handshake (constant-time bearer compare). If the doc isn't currently loaded we
 * 404 (no-op): the DB write already persisted, and loading it just to overwrite
 * would race the editor's own state on next open.
 *
 * Split out of server.ts (which has boot side effects: env asserts +
 * server.listen) so the handler is importable + unit-testable with a fake
 * Hocuspocus instance. `secret` is injected for the same reason.
 */
const REPLACE_PATH = /^\/internal\/pages\/([^/]+)\/replace$/;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // pages are jsonb, not blobs

function bearerOk(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m?.[1]) return false;
  const got = Buffer.from(m[1]);
  const want = Buffer.from(secret);
  return got.length === want.length && got.length > 0 && timingSafeEqual(got, want);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Handle a single internal HTTP request. Returns true if it consumed the request
 * (and wrote a response); false to let Hocuspocus's default handler run.
 */
export async function handleInternalReplace(
  req: IncomingMessage,
  res: ServerResponse,
  instance: Pick<Hocuspocus, 'documents' | 'openDirectConnection'>,
  secret: string,
): Promise<boolean> {
  const path = (req.url ?? '').split('?')[0] ?? '';
  const match = REPLACE_PATH.exec(path);
  if (!match?.[1] || (req.method ?? '').toUpperCase() !== 'POST') return false;

  const send = (status: number, body: Record<string, unknown>) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
    // Hocuspocus's requestHandler writes a default 200 'Welcome' body after the
    // onRequest hooks resolve. Since we've already responded, neutralize the
    // response's write methods so that default write becomes a no-op instead of
    // throwing ERR_HTTP_HEADERS_SENT (which would reject the request handler and
    // — under Node's default unhandled-rejection policy — crash the process).
    res.writeHead = (() => res) as typeof res.writeHead;
    res.end = (() => res) as typeof res.end;
  };

  if (!bearerOk(req.headers.authorization, secret)) {
    send(401, { error: 'unauthorized' });
    return true;
  }

  const pageId = decodeURIComponent(match[1]);

  // No-op when the doc isn't open: the DB write the app already committed is
  // authoritative, and forcing a load here would only invite an overwrite race.
  if (!instance.documents.has(pageId)) {
    send(404, { applied: false, reason: 'not-open' });
    return true;
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(req);
  } catch {
    send(400, { error: 'invalid-body' });
    return true;
  }
  const content = (payload as { content?: unknown } | null)?.content;
  if (content === undefined || content === null || typeof content !== 'object') {
    send(400, { error: 'missing-content' });
    return true;
  }

  try {
    const direct = await instance.openDirectConnection(pageId);
    await direct.transact((document) => {
      // Bind the SAME fragment the editor binds ('default'); replace its children
      // with the API content. Inside transact so the delete+insert is one atomic
      // update broadcast to every connected peer.
      applyProseJsonToFragment(document.getXmlFragment('default'), content);
    });
    await direct.disconnect();
    send(200, { applied: true });
  } catch (err) {
    // Never crash the collab process over a best-effort sync; report 500 so the
    // app logs it, but the app treats any failure as "DB write still stands".
    // (console.warn is in the noConsole allow-list — no suppression needed.)
    console.warn(
      `cairn-collab: internal replace failed page=${pageId} err=${err instanceof Error ? err.message : String(err)}`,
    );
    send(500, { error: 'apply-failed' });
  }
  return true;
}
