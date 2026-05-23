import { resolveToken } from '@/lib/auth/token';
import { MCP_ERROR_CODE, McpError, mcpError } from '@/lib/mcp/error';
import {
  errorEnvelope,
  type JsonRpcId,
  type JsonRpcResponse,
  parseEnvelope,
  routeRpcMethod,
  successEnvelope,
} from '@/lib/mcp/protocol';

// MCP route needs Node APIs (resolveToken DB hit, dispatcher DB writes).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** True if the client wants its single response framed as SSE. */
function wantsSse(req: Request): boolean {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('text/event-stream');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(envelope: JsonRpcResponse): Response {
  // One-shot SSE: emit a single `message` event with the JSON-RPC envelope as
  // its data, then close the stream. Long-lived multi-message sessions are the
  // P8 fallback shim, not this endpoint.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────
  const ctx = await resolveToken(req.headers.get('authorization')).catch(() => null);
  if (!ctx) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (ctx.kind !== 'pat') {
    // MCP is PAT-only by design (api_key tokens have no `mcp:*` scopes anyway).
    return jsonResponse({ error: 'mcp transport requires a personal access token' }, 403);
  }
  const hasMcpScope = ctx.scopes.some((s) => s.startsWith('mcp:'));
  if (!hasMcpScope) {
    return jsonResponse({ error: 'PAT missing any mcp:* scope' }, 403);
  }

  // ── Envelope ──────────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  let envelope: ReturnType<typeof parseEnvelope>;
  let id: JsonRpcId = null;
  try {
    envelope = parseEnvelope(raw);
    id = envelope.id ?? null;
  } catch (err) {
    // Invalid envelope → JSON-RPC error response with id=null per spec.
    const mErr =
      err instanceof McpError ? err : mcpError(MCP_ERROR_CODE.INVALID_REQUEST, 'bad envelope');
    return jsonResponse(errorEnvelope(null, mErr), 400);
  }

  // ── Dispatch ──────────────────────────────────────────────────────────
  try {
    const result = await routeRpcMethod(ctx, envelope.method, envelope.params);
    // Notifications (no id) per JSON-RPC: empty 204 response, no result body.
    if (envelope.id === undefined) {
      return new Response(null, { status: 204 });
    }
    const env = successEnvelope(id, result);
    return wantsSse(req) ? sseResponse(env) : jsonResponse(env, 200);
  } catch (err) {
    const mErr =
      err instanceof McpError
        ? err
        : mcpError(MCP_ERROR_CODE.INTERNAL_ERROR, err instanceof Error ? err.message : 'internal');
    const env = errorEnvelope(id, mErr);
    // HTTP status stays 200 — JSON-RPC carries error in the envelope.
    return wantsSse(req) ? sseResponse(env) : jsonResponse(env, 200);
  }
}
