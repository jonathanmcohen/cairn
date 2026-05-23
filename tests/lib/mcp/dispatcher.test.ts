import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import type { TokenContext } from '@/lib/auth/token';
import { dispatchTool, resetMcpRateLimit } from '@/lib/mcp/dispatcher';
import { MCP_ERROR_CODE } from '@/lib/mcp/error';
import { startPostgres, stopPostgres } from '../../helpers/db';

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

// Seed: a workspace, a user, a PAT row (only needed for the FK on token_usage_log).
let workspaceId: string;
let userId: string;
let patId: string;

beforeEach(async () => {
  await sql`TRUNCATE token_usage_log, personal_access_tokens, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  resetMcpRateLimit();

  const [w] = await db
    .insert(schema.workspaces)
    .values({
      name: 'mcp-disp-test',
      slug: `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  workspaceId = w.id;

  const [u] = await db
    .insert(schema.users)
    .values({
      email: `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@x.test`,
      passwordHash: 'x',
      name: 'disp',
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  userId = u.id;

  const [p] = await db
    .insert(schema.personalAccessTokens)
    .values({
      userId,
      workspaceId,
      name: 'test',
      tokenHash: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tokenPrefix: 'cairn_pat_xxxx',
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.list'],
    })
    .returning();
  if (!p) throw new Error('pat insert failed');
  patId = p.id;
});

function makeCtx(overrides: Partial<TokenContext> = {}): TokenContext {
  return {
    kind: 'pat',
    tokenId: patId,
    userId,
    workspaceId,
    scopes: ['mcp:read', 'pages:read'],
    mcpTools: ['pages.list'],
    ...overrides,
  };
}

describe('dispatchTool — 3-layer enforcement', () => {
  it('METHOD_NOT_FOUND when the tool id is unknown', async () => {
    await expect(dispatchTool(makeCtx(), 'pages.warp', {})).rejects.toMatchObject({
      code: MCP_ERROR_CODE.METHOD_NOT_FOUND,
    });
  });

  it('SCOPE_DENIED when the PAT lacks the tool scope', async () => {
    const ctx = makeCtx({ scopes: ['mcp:read'] }); // missing pages:read
    await expect(dispatchTool(ctx, 'pages.list', {})).rejects.toMatchObject({
      code: MCP_ERROR_CODE.SCOPE_DENIED,
    });
  });

  it('ALLOWLIST_DENIED when the tool id is not in mcpTools', async () => {
    const ctx = makeCtx({ mcpTools: [] }); // empty allowlist = no MCP access
    await expect(dispatchTool(ctx, 'pages.list', {})).rejects.toMatchObject({
      code: MCP_ERROR_CODE.ALLOWLIST_DENIED,
    });
  });

  it('INVALID_PARAMS when args fail Zod parse', async () => {
    const ctx = makeCtx({ mcpTools: ['pages.read'], scopes: ['mcp:read', 'pages:read'] });
    await expect(dispatchTool(ctx, 'pages.read', { pageId: 'not-a-uuid' })).rejects.toMatchObject({
      code: MCP_ERROR_CODE.INVALID_PARAMS,
    });
  });

  it('happy path calls the handler and logs success to token_usage_log', async () => {
    // Stub the handler to avoid spinning up the real page-tree query.
    const tools = await import('@/lib/mcp/tools');
    const original = tools.toolMap.get('pages.list');
    if (!original) throw new Error('pages.list missing from registry');
    const spy = vi.fn(async () => ({ items: [] }));
    tools.toolMap.set('pages.list', { ...original, handler: spy });
    try {
      const out = await dispatchTool(makeCtx(), 'pages.list', { limit: 10 });
      expect(out).toEqual({ items: [] });
      expect(spy).toHaveBeenCalledOnce();

      const rows = await db
        .select()
        .from(schema.tokenUsageLog)
        .where(eq(schema.tokenUsageLog.tokenId, patId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.mcpTool).toBe('pages.list');
      expect(rows[0]?.status).toBe(200);
      expect(rows[0]?.route).toBe('mcp:pages.list');
    } finally {
      tools.toolMap.set('pages.list', original);
    }
  });

  it('handler error logs the failure to token_usage_log', async () => {
    const tools = await import('@/lib/mcp/tools');
    const original = tools.toolMap.get('pages.list');
    if (!original) throw new Error('pages.list missing from registry');
    const boom = vi.fn(async () => {
      throw new Error('handler-blew-up');
    });
    tools.toolMap.set('pages.list', { ...original, handler: boom });
    try {
      await expect(dispatchTool(makeCtx(), 'pages.list', { limit: 10 })).rejects.toMatchObject({
        code: MCP_ERROR_CODE.INTERNAL_ERROR,
      });
      const rows = await db
        .select()
        .from(schema.tokenUsageLog)
        .where(eq(schema.tokenUsageLog.tokenId, patId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe(500);
    } finally {
      tools.toolMap.set('pages.list', original);
    }
  });

  it('an HttpError(403) from the handler maps to ACL_DENIED', async () => {
    const tools = await import('@/lib/mcp/tools');
    const { HttpError } = await import('@/lib/auth/require-role');
    const original = tools.toolMap.get('pages.list');
    if (!original) throw new Error('pages.list missing from registry');
    const denied = vi.fn(async () => {
      throw new HttpError(403, 'forbidden');
    });
    tools.toolMap.set('pages.list', { ...original, handler: denied });
    try {
      await expect(dispatchTool(makeCtx(), 'pages.list', { limit: 10 })).rejects.toMatchObject({
        code: MCP_ERROR_CODE.ACL_DENIED,
      });
      const rows = await db
        .select()
        .from(schema.tokenUsageLog)
        .where(eq(schema.tokenUsageLog.tokenId, patId));
      expect(rows[0]?.status).toBe(403);
    } finally {
      tools.toolMap.set('pages.list', original);
    }
  });

  it('an HttpError(404) collapses to ACL_DENIED (existence-hiding)', async () => {
    const tools = await import('@/lib/mcp/tools');
    const { HttpError } = await import('@/lib/auth/require-role');
    const original = tools.toolMap.get('pages.list');
    if (!original) throw new Error('pages.list missing from registry');
    tools.toolMap.set('pages.list', {
      ...original,
      handler: async () => {
        throw new HttpError(404, 'not found');
      },
    });
    try {
      await expect(dispatchTool(makeCtx(), 'pages.list', { limit: 10 })).rejects.toMatchObject({
        code: MCP_ERROR_CODE.ACL_DENIED,
      });
    } finally {
      tools.toolMap.set('pages.list', original);
    }
  });

  it('rate-limits per (token_id, tool_id)', async () => {
    const tools = await import('@/lib/mcp/tools');
    const original = tools.toolMap.get('pages.list');
    if (!original) throw new Error('pages.list missing from registry');
    tools.toolMap.set('pages.list', { ...original, handler: async () => ({ ok: true }) });
    try {
      process.env.CAIRN_MCP_RATE_LIMIT_PER_MIN = '3';
      resetMcpRateLimit();
      for (let i = 0; i < 3; i++) {
        await dispatchTool(makeCtx(), 'pages.list', { limit: 10 });
      }
      await expect(dispatchTool(makeCtx(), 'pages.list', { limit: 10 })).rejects.toMatchObject({
        code: MCP_ERROR_CODE.RATE_LIMITED,
      });
    } finally {
      tools.toolMap.set('pages.list', original);
      process.env.CAIRN_MCP_RATE_LIMIT_PER_MIN = undefined;
      delete process.env.CAIRN_MCP_RATE_LIMIT_PER_MIN;
      resetMcpRateLimit();
    }
  });

  it('the dispatcher source NEVER imports requirePageAcl', async () => {
    // Sanity assertion: the dispatcher module does not import `requirePageAcl`.
    // (Guard against regressing into double-enforcement.)
    const src = await import('node:fs').then((m) =>
      m.promises.readFile(new URL('../../../src/lib/mcp/dispatcher.ts', import.meta.url), 'utf-8'),
    );
    expect(src).not.toContain('requirePageAcl');
  });

  it('admin scope bypasses per-resource scope checks', async () => {
    const tools = await import('@/lib/mcp/tools');
    const original = tools.toolMap.get('pages.list');
    if (!original) throw new Error('pages.list missing from registry');
    tools.toolMap.set('pages.list', { ...original, handler: async () => ({ items: [] }) });
    try {
      const ctx = makeCtx({ scopes: ['admin'] }); // admin only — no pages:read
      const out = await dispatchTool(ctx, 'pages.list', {});
      expect(out).toEqual({ items: [] });
    } finally {
      tools.toolMap.set('pages.list', original);
    }
  });
});
