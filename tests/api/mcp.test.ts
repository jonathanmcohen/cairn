import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { resetMcpRateLimit } from '@/lib/mcp/dispatcher';
import { toolMap } from '@/lib/mcp/tools';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

// resolveToken + dispatcher read the live db via getDb(); pin the test container.
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
});

async function seedPat(opts: {
  scopes: string[];
  mcpTools: string[];
}): Promise<{ token: string; workspaceId: string; userId: string }> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const { token } = await mintPat(db, {
    userId: u.userId,
    workspaceId: u.workspaceId,
    name: 'mcp-test',
    scopes: opts.scopes,
    mcpTools: opts.mcpTools,
    expiresAt: null,
  });
  return { token, workspaceId: u.workspaceId, userId: u.userId };
}

async function postMcp(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import('@/app/api/mcp/route');
  return POST(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/mcp', () => {
  it('401 with no Authorization header', async () => {
    const res = await postMcp({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
  });

  it('401 with a bogus bearer', async () => {
    const res = await postMcp(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { authorization: 'Bearer cairn_pat_not-a-real-token' },
    );
    expect(res.status).toBe(401);
  });

  it('403 when the PAT has no mcp:* scope', async () => {
    const { token } = await seedPat({ scopes: ['pages:read'], mcpTools: ['pages.list'] });
    const res = await postMcp(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(403);
  });

  it('initialize handshake returns protocolVersion + capabilities', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const res = await postMcp(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', clientInfo: { name: 't', version: '1' } },
      },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jsonrpc: string;
      id: number;
      result: {
        protocolVersion: string;
        capabilities: { tools: unknown };
        serverInfo: { name: string };
      };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe('cairn');
  });

  it('tools/list filtered to allowlist ∩ scope', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const res = await postMcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { authorization: `Bearer ${token}` },
    );
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(['pages.list', 'pages.read']);
  });

  it('tools/call dispatches a stubbed handler and wraps the result', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const original = toolMap.get('pages.list');
    if (!original) throw new Error('pages.list not registered');
    toolMap.set('pages.list', { ...original, handler: async () => ({ items: ['x'] }) });
    try {
      const res = await postMcp(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'pages.list', arguments: { limit: 5 } },
        },
        { authorization: `Bearer ${token}` },
      );
      const body = (await res.json()) as {
        result: { isError: boolean; content: { text: string }[] };
      };
      expect(body.result.isError).toBe(false);
      expect(JSON.parse(body.result.content[0]?.text ?? '')).toEqual({ items: ['x'] });
    } finally {
      toolMap.set('pages.list', original);
    }
  });

  it('ping → empty result object', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const res = await postMcp(
      { jsonrpc: '2.0', id: 4, method: 'ping' },
      { authorization: `Bearer ${token}` },
    );
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect(body.result).toEqual({});
  });

  it('SSE response when Accept: text/event-stream', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const res = await postMcp(
      { jsonrpc: '2.0', id: 5, method: 'ping' },
      { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    );
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toMatch(/^event: message\ndata: .*\n\n$/);
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) throw new Error('SSE data line missing');
    const payload = JSON.parse(dataLine.slice('data: '.length)) as {
      jsonrpc: string;
      id: number;
    };
    expect(payload.jsonrpc).toBe('2.0');
    expect(payload.id).toBe(5);
  });

  it('returns 204 for notifications (envelope without id)', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const res = await postMcp(
      { jsonrpc: '2.0', method: 'ping' }, // no id
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(204);
  });

  it('malformed JSON-RPC envelope → 400 with INVALID_REQUEST error', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const res = await postMcp(
      { jsonrpc: '1.0', id: 6, method: 'ping' },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32600);
  });

  it('records every dispatched tools/call to token_usage_log', async () => {
    const { token } = await seedPat({
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list', 'pages.read'],
    });
    const original = toolMap.get('pages.list');
    if (!original) throw new Error('pages.list not registered');
    toolMap.set('pages.list', { ...original, handler: async () => ({ ok: true }) });
    try {
      await postMcp(
        {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'pages.list', arguments: { limit: 1 } },
        },
        { authorization: `Bearer ${token}` },
      );
      const rows = await db.select().from(schema.tokenUsageLog);
      expect(rows.length).toBeGreaterThan(0);
      const call = rows.find((r) => r.route === 'mcp:pages.list');
      expect(call?.status).toBe(200);
      expect(call?.mcpTool).toBe('pages.list');
    } finally {
      toolMap.set('pages.list', original);
    }
  });
});
