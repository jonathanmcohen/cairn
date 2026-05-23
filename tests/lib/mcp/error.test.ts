import { describe, expect, it } from 'vitest';
import { MCP_ERROR_CODE, McpError, mcpError } from '@/lib/mcp/error';

describe('mcpError builder', () => {
  it('exposes the JSON-RPC + Cairn-domain code constants', () => {
    expect(MCP_ERROR_CODE.PARSE_ERROR).toBe(-32700);
    expect(MCP_ERROR_CODE.INVALID_REQUEST).toBe(-32600);
    expect(MCP_ERROR_CODE.METHOD_NOT_FOUND).toBe(-32601);
    expect(MCP_ERROR_CODE.INVALID_PARAMS).toBe(-32602);
    expect(MCP_ERROR_CODE.INTERNAL_ERROR).toBe(-32603);
    expect(MCP_ERROR_CODE.SCOPE_DENIED).toBe(-32001);
    expect(MCP_ERROR_CODE.ALLOWLIST_DENIED).toBe(-32002);
    expect(MCP_ERROR_CODE.ACL_DENIED).toBe(-32003);
    expect(MCP_ERROR_CODE.RATE_LIMITED).toBe(-32004);
  });

  it('builds an McpError with code + message + optional data', () => {
    const e = mcpError(MCP_ERROR_CODE.SCOPE_DENIED, 'missing scope', { required: 'mcp:write' });
    expect(e).toBeInstanceOf(McpError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(-32001);
    expect(e.message).toBe('missing scope');
    expect(e.data).toEqual({ required: 'mcp:write' });
  });

  it('serializes to a JSON-RPC error object with toJSON()', () => {
    const e = mcpError(MCP_ERROR_CODE.METHOD_NOT_FOUND, 'unknown tool', { tool: 'pages.warp' });
    expect(e.toJSON()).toEqual({
      code: -32601,
      message: 'unknown tool',
      data: { tool: 'pages.warp' },
    });
  });

  it('omits `data` from the wire form when undefined', () => {
    const e = mcpError(MCP_ERROR_CODE.INTERNAL_ERROR, 'boom');
    expect(e.toJSON()).toEqual({ code: -32603, message: 'boom' });
  });
});
