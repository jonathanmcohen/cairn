import { resolveToken } from '@/lib/auth/token';
import { MCP_ERROR_CODE, McpError, mcpError } from '@/lib/mcp/error';
import {
  errorEnvelope,
  type JsonRpcId,
  parseEnvelope,
  routeRpcMethod,
  successEnvelope,
} from '@/lib/mcp/protocol';
import { getSession, sendToSession } from '@/lib/mcp/session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await resolveToken(req.headers.get('authorization')).catch(() => null);
  if (!ctx) return jsonResponse({ error: 'unauthorized' }, 401);
  if (ctx.kind !== 'pat') return jsonResponse({ error: 'mcp requires a PAT' }, 403);
  const hasMcpScope = ctx.scopes.some((s) => s.startsWith('mcp:'));
  if (!hasMcpScope) return jsonResponse({ error: 'PAT missing mcp:* scope' }, 403);

  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') ?? '';
  if (!sessionId) return jsonResponse({ error: 'missing sessionId' }, 400);

  const session = getSession(sessionId);
  if (!session) return jsonResponse({ error: 'session not found' }, 404);
  // Bind the session to the PAT that opened it: a different PAT cannot post
  // into someone else's session even with valid auth.
  if (session.tokenId !== ctx.tokenId) {
    return jsonResponse({ error: 'session does not belong to this token' }, 403);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  let id: JsonRpcId = null;
  let envelope: ReturnType<typeof parseEnvelope>;
  try {
    envelope = parseEnvelope(raw);
    id = envelope.id ?? null;
  } catch (err) {
    const mErr =
      err instanceof McpError ? err : mcpError(MCP_ERROR_CODE.INVALID_REQUEST, 'bad envelope');
    sendToSession(sessionId, errorEnvelope(null, mErr));
    return new Response(null, { status: 202 });
  }

  // Dispatch off the request thread so the POST returns 202 immediately and
  // the response arrives over the SSE channel — matches the original MCP SSE
  // transport's behavior.
  try {
    const result = await routeRpcMethod(session.ctx, envelope.method, envelope.params);
    if (envelope.id === undefined) {
      // Notification → don't write any response back to the session.
      return new Response(null, { status: 202 });
    }
    sendToSession(sessionId, successEnvelope(id, result));
  } catch (err) {
    const mErr =
      err instanceof McpError
        ? err
        : mcpError(MCP_ERROR_CODE.INTERNAL_ERROR, err instanceof Error ? err.message : 'internal');
    sendToSession(sessionId, errorEnvelope(id, mErr));
  }
  return new Response(null, { status: 202 });
}
