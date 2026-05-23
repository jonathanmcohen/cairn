/**
 * JSON-RPC 2.0 + Cairn-domain MCP error codes.
 *
 * The -32700 ... -32603 range is the JSON-RPC reserved set; everything in
 * -32099 ... -32000 is "server-defined", per the spec — Cairn allocates
 * -32001 ... -32004 for the four enforcement-layer failures.
 *
 * The `McpError` class is a typed `Error` subclass; the dispatcher / transports
 * throw it, catch it at the JSON-RPC envelope boundary, and serialize via
 * `toJSON()` into the response `error` member.
 */
export const MCP_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Cairn-domain codes — server-defined range.
  SCOPE_DENIED: -32001,
  ALLOWLIST_DENIED: -32002,
  ACL_DENIED: -32003,
  RATE_LIMITED: -32004,
} as const;

export type McpErrorCode = (typeof MCP_ERROR_CODE)[keyof typeof MCP_ERROR_CODE];

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly data?: unknown;

  constructor(code: McpErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }

  toJSON(): { code: number; message: string; data?: unknown } {
    const out: { code: number; message: string; data?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) out.data = this.data;
    return out;
  }
}

export function mcpError(code: McpErrorCode, message: string, data?: unknown): McpError {
  return new McpError(code, message, data);
}
