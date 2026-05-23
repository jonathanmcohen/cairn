import { describe, expect, it } from 'vitest';
import type { TokenContext } from '@/lib/auth/token';
import { MCP_ERROR_CODE, McpError } from '@/lib/mcp/error';
import {
  handleInitialize,
  handlePing,
  handleToolsCall,
  handleToolsList,
  isJsonRpcRequest,
  MCP_PROTOCOL_VERSION,
  parseEnvelope,
} from '@/lib/mcp/protocol';
import { toolMap } from '@/lib/mcp/tools';

const ctx: TokenContext = {
  kind: 'pat',
  tokenId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  scopes: ['mcp:read', 'pages:read'],
  mcpTools: ['pages.list', 'pages.read'],
};

describe('parseEnvelope', () => {
  it('parses a valid JSON-RPC 2.0 request', () => {
    const env = parseEnvelope({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
    expect(env).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
  });

  it('rejects a non-2.0 envelope with INVALID_REQUEST', () => {
    expect(() => parseEnvelope({ jsonrpc: '1.0', id: 1, method: 'ping' })).toThrow(McpError);
    try {
      parseEnvelope({ jsonrpc: '1.0', id: 1, method: 'ping' });
    } catch (e) {
      expect((e as McpError).code).toBe(MCP_ERROR_CODE.INVALID_REQUEST);
    }
  });

  it('rejects garbage with INVALID_REQUEST', () => {
    expect(() => parseEnvelope({})).toThrow();
    expect(() => parseEnvelope(null)).toThrow();
    expect(() => parseEnvelope('string')).toThrow();
  });

  it('accepts notification (no id)', () => {
    const env = parseEnvelope({ jsonrpc: '2.0', method: 'ping' });
    expect(env.id).toBeUndefined();
    expect(env.method).toBe('ping');
  });

  it('isJsonRpcRequest narrows the type', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'ping' })).toBe(true);
    expect(isJsonRpcRequest({ jsonrpc: '1.0', method: 'ping' })).toBe(false);
    expect(isJsonRpcRequest(null)).toBe(false);
  });
});

describe('handleInitialize', () => {
  it('returns the server protocol version + capabilities', async () => {
    const result = await handleInitialize(ctx, {
      protocolVersion: '2025-03-26',
      clientInfo: { name: 'test-client', version: '0.1.0' },
    });
    expect(result.protocolVersion).toBe('2025-03-26');
    expect(result.serverInfo).toEqual({ name: 'cairn', version: expect.any(String) });
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it('echoes back whatever protocol version the client sent (spec churn tolerance)', async () => {
    const r = await handleInitialize(ctx, {
      protocolVersion: '2099-01-01',
      clientInfo: { name: 'future', version: '1.0' },
    });
    expect(r.protocolVersion).toBe('2099-01-01');
  });

  it('falls back to MCP_PROTOCOL_VERSION when client omits version', async () => {
    const r = await handleInitialize(ctx, { clientInfo: { name: 'x', version: '0' } } as never);
    expect(r.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });
});

describe('handleToolsList', () => {
  it('filters by scope AND allowlist', async () => {
    const limited: TokenContext = {
      ...ctx,
      mcpTools: ['pages.list'],
      scopes: ['mcp:read', 'pages:read'],
    };
    const r = await handleToolsList(limited);
    const ids = r.tools.map((t) => t.name);
    expect(ids).toEqual(['pages.list']);
  });

  it('respects empty allowlist (returns no tools)', async () => {
    const r = await handleToolsList({ ...ctx, mcpTools: [] });
    expect(r.tools).toEqual([]);
  });

  it('admin scope still respects the allowlist (allowlist is the safety floor)', async () => {
    const r = await handleToolsList({ ...ctx, scopes: ['admin'], mcpTools: ['pages.read'] });
    expect(r.tools.map((t) => t.name)).toEqual(['pages.read']);
  });

  it('emits the input schema in JSON-Schema form', async () => {
    const r = await handleToolsList(ctx);
    const pagesRead = r.tools.find((t) => t.name === 'pages.read');
    expect(pagesRead).toBeDefined();
    expect(pagesRead?.inputSchema).toBeDefined();
    expect(pagesRead?.inputSchema.type).toBe('object');
  });
});

describe('handlePing', () => {
  it('returns an empty result object', async () => {
    expect(await handlePing(ctx)).toEqual({});
  });
});

describe('handleToolsCall', () => {
  it('forwards to dispatchTool and wraps the result in { content: [...] }', async () => {
    const original = toolMap.get('pages.list');
    if (!original) throw new Error('pages.list not registered');
    toolMap.set('pages.list', { ...original, handler: async () => ({ items: ['a'] }) });
    try {
      const r = await handleToolsCall(ctx, { name: 'pages.list', arguments: { limit: 10 } });
      expect(r.content).toHaveLength(1);
      expect(r.content[0]?.type).toBe('text');
      expect(JSON.parse(r.content[0]?.text ?? '')).toEqual({ items: ['a'] });
      expect(r.isError).toBe(false);
    } finally {
      toolMap.set('pages.list', original);
    }
  });

  it('throws METHOD_NOT_FOUND from the dispatcher for unknown tools', async () => {
    const r = await handleToolsCall(ctx, { name: 'pages.warp', arguments: {} }).catch((e) => e);
    expect(r).toBeInstanceOf(McpError);
    expect((r as McpError).code).toBe(MCP_ERROR_CODE.METHOD_NOT_FOUND);
  });

  it('INVALID_PARAMS when params shape is wrong', async () => {
    const r = await handleToolsCall(ctx, { name: 123 as never }).catch((e) => e);
    expect(r).toBeInstanceOf(McpError);
    expect((r as McpError).code).toBe(MCP_ERROR_CODE.INVALID_PARAMS);
  });
});
