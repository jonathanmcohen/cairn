import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { resetMcpRateLimit } from '@/lib/mcp/dispatcher';
import { resetSessionStore } from '@/lib/mcp/session-store';
import { toolMap } from '@/lib/mcp/tools';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

// resolveToken reads the live db via getDb(); pin to the test container.
vi.mock('@/db/client', () => ({
  getDb: () => db,
}));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE token_usage_log, personal_access_tokens, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  resetMcpRateLimit();
  resetSessionStore();
});

async function seedPat(opts: {
  scopes: string[];
  mcpTools: string[];
}): Promise<{ token: string; workspaceId: string; userId: string }> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const { token } = await mintPat(db, {
    userId: u.userId,
    workspaceId: u.workspaceId,
    name: 'mcp-sse-test',
    scopes: opts.scopes,
    mcpTools: opts.mcpTools,
    expiresAt: null,
  });
  return { token, workspaceId: u.workspaceId, userId: u.userId };
}

async function openSse(authHeader?: string): Promise<{ res: Response; ac: AbortController }> {
  const { GET } = await import('@/app/api/mcp/sse/route');
  const ac = new AbortController();
  const req = new Request('http://localhost/api/mcp/sse', {
    method: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
    signal: ac.signal,
  });
  const res = await GET(req);
  return { res, ac };
}

async function readNextChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const dec = new TextDecoder();
  const { value, done } = await reader.read();
  if (done) return '';
  return dec.decode(value);
}

describe('SSE fallback shim', () => {
  it('401 at SSE open with no Authorization header', async () => {
    const { res } = await openSse();
    expect(res.status).toBe(401);
  });

  it('opens the stream and emits the initial endpoint event with sessionId', async () => {
    const { token } = await seedPat({ scopes: ['mcp:read'], mcpTools: ['pages.list'] });
    const { res, ac } = await openSse(`Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body reader');
    const first = await readNextChunk(reader);
    expect(first).toContain('event: endpoint');
    expect(first).toMatch(/sessionId=[0-9a-f-]{36}/);
    ac.abort();
  });

  it('POST /api/mcp/messages routes the response back to the SSE stream', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list'],
    });
    // Stub pages.list to a known shape so we don't depend on the page tree helper.
    const original = toolMap.get('pages.list');
    if (!original) throw new Error('pages.list not registered');
    toolMap.set('pages.list', { ...original, handler: async () => ({ items: ['hello'] }) });
    try {
      const { res, ac } = await openSse(`Bearer ${token}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('no body reader');
      const first = await readNextChunk(reader);
      const match = /sessionId=([0-9a-f-]{36})/.exec(first);
      expect(match).not.toBeNull();
      const sessionId = match?.[1] ?? '';
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

      const { POST } = await import('@/app/api/mcp/messages/route');
      const postRes = await POST(
        new Request(`http://localhost/api/mcp/messages?sessionId=${sessionId}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 42,
            method: 'tools/call',
            params: { name: 'pages.list', arguments: { limit: 1 } },
          }),
        }),
      );
      expect(postRes.status).toBe(202);

      // The response event should now be on the SSE reader.
      const evt = await readNextChunk(reader);
      expect(evt).toContain('event: message');
      const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) throw new Error('no data line in SSE event');
      const payload = JSON.parse(dataLine.slice('data: '.length)) as {
        jsonrpc: string;
        id: number;
        result: { content: { text: string }[] };
      };
      expect(payload.jsonrpc).toBe('2.0');
      expect(payload.id).toBe(42);
      expect(JSON.parse(payload.result.content[0]?.text ?? '')).toEqual({ items: ['hello'] });
      ac.abort();
    } finally {
      toolMap.set('pages.list', original);
    }
  });

  it('POST /messages with unknown sessionId returns 404', async () => {
    const { token } = await seedPat({ scopes: ['mcp:read'], mcpTools: ['pages.list'] });
    const { POST } = await import('@/app/api/mcp/messages/route');
    const postRes = await POST(
      new Request(
        `http://localhost/api/mcp/messages?sessionId=00000000-0000-4000-8000-000000000999`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        },
      ),
    );
    expect(postRes.status).toBe(404);
  });

  it('POST /messages with a foreign PAT against an existing session returns 403', async () => {
    // Open session with PAT A.
    const a = await seedPat({ scopes: ['mcp:read'], mcpTools: ['pages.list'] });
    const { res: sseRes, ac } = await openSse(`Bearer ${a.token}`);
    const reader = sseRes.body?.getReader();
    if (!reader) throw new Error('no body reader');
    const first = await readNextChunk(reader);
    const sessionIdMatch = /sessionId=([0-9a-f-]{36})/.exec(first);
    const sessionId = sessionIdMatch?.[1] ?? '';
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // Mint PAT B (different user/workspace, different token).
    const b = await seedPat({ scopes: ['mcp:read'], mcpTools: ['pages.list'] });

    const { POST } = await import('@/app/api/mcp/messages/route');
    const postRes = await POST(
      new Request(`http://localhost/api/mcp/messages?sessionId=${sessionId}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    );
    expect(postRes.status).toBe(403);
    ac.abort();
  });

  it('aborting the SSE request evicts the session from the store', async () => {
    const { token } = await seedPat({ scopes: ['mcp:read'], mcpTools: ['pages.list'] });
    const { res, ac } = await openSse(`Bearer ${token}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body reader');
    const first = await readNextChunk(reader);
    const sessionIdMatch = /sessionId=([0-9a-f-]{36})/.exec(first);
    const sessionId = sessionIdMatch?.[1] ?? '';
    const { getSession } = await import('@/lib/mcp/session-store');
    expect(getSession(sessionId)).toBeDefined();
    ac.abort();
    // Give the abort listener a tick to run.
    await new Promise((r) => setImmediate(r));
    expect(getSession(sessionId)).toBeUndefined();
  });
});
