import { resolveToken } from '@/lib/auth/token';
import { closeSession, createSession, sweepExpiredSessions } from '@/lib/mcp/session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Module-load: schedule a background sweep. Single-instance ceiling per
// docs/operations.md — multi-instance deployments must pin the SSE client
// + the messages POST to the same process.
let sweepHandle: ReturnType<typeof setInterval> | null = null;
function startSweep(): void {
  if (sweepHandle !== null) return;
  // Sweep every 60s; cheap O(n) over the active session set.
  sweepHandle = setInterval(() => {
    try {
      sweepExpiredSessions();
    } catch {
      // best-effort; never throws into the timer.
    }
  }, 60_000);
  // Allow Node to exit even if the interval is still scheduled (test process).
  if (typeof sweepHandle.unref === 'function') sweepHandle.unref();
}

export async function GET(req: Request): Promise<Response> {
  const ctx = await resolveToken(req.headers.get('authorization')).catch(() => null);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  if (ctx.kind !== 'pat') return new Response('mcp transport requires a PAT', { status: 403 });
  const hasMcpScope = ctx.scopes.some((s) => s.startsWith('mcp:'));
  if (!hasMcpScope) return new Response('PAT missing mcp:* scope', { status: 403 });

  startSweep();

  const url = new URL(req.url);
  const provided = url.searchParams.get('sessionId') ?? undefined;

  const enc = new TextEncoder();
  let registeredSessionId: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const { sessionId } = createSession(ctx, controller, provided ?? undefined);
      registeredSessionId = sessionId;
      // Initial `endpoint` event — gives the client the messages POST URL with
      // sessionId baked in. This is the pre-handshake event clients look for.
      const endpoint = `/api/mcp/messages?sessionId=${sessionId}`;
      controller.enqueue(enc.encode(`event: endpoint\ndata: ${endpoint}\n\n`));
      // Optional heartbeat every 30s so the connection isn't reaped by proxies.
      const hb = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`:heartbeat\n\n`));
        } catch {
          clearInterval(hb);
        }
      }, 30_000);
      if (typeof hb.unref === 'function') hb.unref();
      // When the client aborts, close the session.
      req.signal.addEventListener('abort', () => {
        clearInterval(hb);
        if (registeredSessionId) closeSession(registeredSessionId);
      });
    },
    cancel() {
      if (registeredSessionId) closeSession(registeredSessionId);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable Nginx response buffering — SSE needs immediate flush.
      'x-accel-buffering': 'no',
    },
  });
}
