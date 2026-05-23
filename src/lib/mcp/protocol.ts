import { type ZodTypeAny, z } from 'zod';
import type { TokenContext } from '@/lib/auth/token';
import { appVersion } from '@/lib/version';
import { dispatchTool } from './dispatcher';
import { MCP_ERROR_CODE, type McpError, mcpError } from './error';
import { registry, toolMap } from './tools';

/**
 * MCP protocol-version pin. The published spec snapshot Cairn targets for
 * v0.7.0. We accept and echo back whatever the client sends in `initialize`
 * (spec §6 risk 1 — permissive across spec churn).
 */
export const MCP_PROTOCOL_VERSION = '2025-03-26';

// ── JSON-RPC 2.0 envelope shapes ────────────────────────────────────────────

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId; // optional → notification
  method: string;
  params?: unknown;
};

export type JsonRpcSuccess<T = unknown> = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: T;
};

export type JsonRpcErrorPayload = { code: number; message: string; data?: unknown };

export type JsonRpcErrorResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcErrorPayload;
};

export type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcErrorResponse;

export function isJsonRpcRequest(x: unknown): x is JsonRpcRequest {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return o.jsonrpc === '2.0' && typeof o.method === 'string';
}

export function parseEnvelope(x: unknown): JsonRpcRequest {
  if (!isJsonRpcRequest(x)) {
    throw mcpError(MCP_ERROR_CODE.INVALID_REQUEST, 'not a JSON-RPC 2.0 request');
  }
  return x;
}

export function successEnvelope<T>(id: JsonRpcId, result: T): JsonRpcSuccess<T> {
  return { jsonrpc: '2.0', id, result };
}

export function errorEnvelope(id: JsonRpcId, err: McpError): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', id, error: err.toJSON() };
}

// ── method handlers ─────────────────────────────────────────────────────────

const InitParams = z.object({
  protocolVersion: z.string().optional(),
  clientInfo: z.object({ name: z.string(), version: z.string() }).optional(),
  capabilities: z.unknown().optional(),
});

export type InitializeResult = {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: { tools: { listChanged: boolean } };
};

export async function handleInitialize(
  _ctx: TokenContext,
  rawParams: unknown,
): Promise<InitializeResult> {
  const parsed = InitParams.safeParse(rawParams ?? {});
  const params = parsed.success ? parsed.data : {};
  return {
    protocolVersion: params.protocolVersion ?? MCP_PROTOCOL_VERSION,
    serverInfo: { name: 'cairn', version: appVersion() },
    capabilities: { tools: { listChanged: false } },
  };
}

type JsonSchemaProp = { type: string; description?: string };
type JsonSchemaObject = {
  type: 'object';
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

/**
 * Translate the Zod schema attached to each tool into a minimal JSON-Schema
 * shape that LLM clients understand. We do NOT take a full Zod → JSON-Schema
 * dep; instead we hand-build an `{ type: 'object', properties: {...} }` skin
 * good enough for the LLM to fill in arg names. The dispatcher re-validates
 * against the real Zod schema before calling the handler, so the JSON-Schema
 * here is documentation, not enforcement.
 */
function inputSchemaToJsonSchema(schema: ZodTypeAny): JsonSchemaObject {
  // Best effort: if the schema is a ZodObject we can enumerate; else fall back.
  const def = (
    schema as unknown as {
      _def?: { typeName?: string; shape?: () => Record<string, ZodTypeAny> };
    }
  )._def;
  if (def?.typeName === 'ZodObject' && typeof def.shape === 'function') {
    const shape = def.shape();
    const props: Record<string, JsonSchemaProp> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const vDef = (v as unknown as { _def?: { typeName?: string } })._def;
      const typeName = vDef?.typeName ?? 'ZodUnknown';
      const isOptional = typeName === 'ZodOptional' || typeName === 'ZodDefault';
      props[k] = { type: 'string', description: typeName };
      if (!isOptional) required.push(k);
    }
    return { type: 'object', properties: props, required };
  }
  return { type: 'object' };
}

export type ToolListEntry = {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
};

export async function handleToolsList(ctx: TokenContext): Promise<{ tools: ToolListEntry[] }> {
  const visible = registry.filter(
    (t) =>
      ctx.mcpTools.includes(t.id) && (ctx.scopes.includes(t.scope) || ctx.scopes.includes('admin')),
  );
  return {
    tools: visible.map((t) => ({
      name: t.id,
      description: t.description,
      inputSchema: inputSchemaToJsonSchema(t.inputSchema),
    })),
  };
}

const ToolsCallParams = z.object({
  name: z.string(),
  arguments: z.unknown().optional(),
});

export type ToolsCallResult = {
  content: { type: 'text'; text: string }[];
  isError: boolean;
};

export async function handleToolsCall(
  ctx: TokenContext,
  rawParams: unknown,
): Promise<ToolsCallResult> {
  const parsed = ToolsCallParams.safeParse(rawParams);
  if (!parsed.success) {
    throw mcpError(MCP_ERROR_CODE.INVALID_PARAMS, 'invalid params for tools/call', {
      issues: parsed.error.issues,
    });
  }
  const result = await dispatchTool(ctx, parsed.data.name, parsed.data.arguments ?? {});
  // MCP wraps tool results in `{ content: [{type: 'text', text: ...}], isError }`.
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: false,
  };
}

export async function handlePing(_ctx: TokenContext): Promise<Record<string, never>> {
  return {};
}

// ── method router (called by route + SSE shim) ──────────────────────────────

export async function routeRpcMethod(
  ctx: TokenContext,
  method: string,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return handleInitialize(ctx, params);
    case 'tools/list':
      return handleToolsList(ctx);
    case 'tools/call':
      return handleToolsCall(ctx, params);
    case 'ping':
      return handlePing(ctx);
    default:
      throw mcpError(MCP_ERROR_CODE.METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
}

// Re-exports so transport modules have a single import surface.
export { toolMap };
