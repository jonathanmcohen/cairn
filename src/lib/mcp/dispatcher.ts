import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import type { TokenContext } from '@/lib/auth/token';
import { logger } from '@/lib/observability/logger';
import { MCP_ERROR_CODE, McpError, mcpError } from './error';
import { toolMap } from './tools';

/**
 * Per-(token, tool) token-bucket rate limit. In-process map (single-instance
 * ceiling — see CLAUDE.md / SECURITY.md). The bucket size defaults to 60 / min;
 * override with `CAIRN_MCP_RATE_LIMIT_PER_MIN` for tests.
 *
 * The auth surfaces already share `src/lib/security/rate-limit.ts`'s
 * `RateLimiter` class; that exposes a non-mutable `opts` so a per-call limit
 * override (used in the test path) would force a new instance per check. The
 * MCP limiter therefore keeps its own slim bucket map but follows the same
 * shape (`{ tokens, updatedAt }` + linear refill).
 */
type Bucket = { tokens: number; updatedAt: number };
const buckets: Map<string, Bucket> = new Map();

function rateLimitPerMin(): number {
  const raw = process.env.CAIRN_MCP_RATE_LIMIT_PER_MIN;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function consumeToken(key: string): boolean {
  const limit = rateLimitPerMin();
  const now = Date.now();
  const cur = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  // Refill linearly over a 60-second window.
  const elapsedMs = Math.max(0, now - cur.updatedAt);
  const refill = (elapsedMs / 60_000) * limit;
  cur.tokens = Math.min(limit, cur.tokens + refill);
  cur.updatedAt = now;
  if (cur.tokens < 1) {
    buckets.set(key, cur);
    return false;
  }
  cur.tokens -= 1;
  buckets.set(key, cur);
  return true;
}

/** Test-only: reset every bucket. */
export function resetMcpRateLimit(): void {
  buckets.clear();
}

/**
 * Map a thrown error into an `McpError` for the wire response. The dispatcher
 * never re-implements ACL — it only translates the HttpError(403/404) shape the
 * library helpers throw into the MCP error vocabulary. HttpError(404) collapses
 * to ACL_DENIED on purpose: cross-workspace ids already return 404 (not 403) so
 * we don't leak existence (matches the v0.6 `requirePageAccess` pattern).
 */
function toMcpError(err: unknown): McpError {
  if (err instanceof McpError) return err;
  if (err instanceof z.ZodError) {
    return mcpError(MCP_ERROR_CODE.INVALID_PARAMS, 'invalid params', { issues: err.issues });
  }
  if (err instanceof HttpError) {
    if (err.status === 403 || err.status === 404) {
      return mcpError(MCP_ERROR_CODE.ACL_DENIED, err.message);
    }
    if (err.status === 400) {
      return mcpError(MCP_ERROR_CODE.INVALID_PARAMS, err.message);
    }
    if (err.status === 429) {
      return mcpError(MCP_ERROR_CODE.RATE_LIMITED, err.message);
    }
    return mcpError(MCP_ERROR_CODE.INTERNAL_ERROR, err.message);
  }
  const msg = err instanceof Error ? err.message : 'internal error';
  return mcpError(MCP_ERROR_CODE.INTERNAL_ERROR, msg);
}

function statusForCode(code: number): number {
  switch (code) {
    case MCP_ERROR_CODE.SCOPE_DENIED:
    case MCP_ERROR_CODE.ALLOWLIST_DENIED:
    case MCP_ERROR_CODE.ACL_DENIED:
      return 403;
    case MCP_ERROR_CODE.METHOD_NOT_FOUND:
      return 404;
    case MCP_ERROR_CODE.INVALID_PARAMS:
    case MCP_ERROR_CODE.INVALID_REQUEST:
      return 400;
    case MCP_ERROR_CODE.RATE_LIMITED:
      return 429;
    default:
      return 500;
  }
}

async function logUsage(ctx: TokenContext, toolId: string, status: number): Promise<void> {
  try {
    await getDb()
      .insert(schema.tokenUsageLog)
      .values({
        workspaceId: ctx.workspaceId,
        tokenKind: ctx.kind,
        tokenId: ctx.tokenId,
        userId: ctx.userId ?? null,
        route: `mcp:${toolId}`,
        status,
        mcpTool: toolId,
      });
  } catch (err) {
    // The log itself MUST NEVER break the dispatch result.
    logger.error(
      { err: err instanceof Error ? err.message : err, toolId },
      '[mcp] token_usage_log insert failed',
    );
  }
  // TODO(P9): emit `mcp_tool_called_total{tool, outcome}` here once P9's
  // metric registration lands. Outcome vocabulary: success | scope_denied |
  // allowlist_denied | acl_denied | invalid_params | rate_limited | error.
}

/**
 * Dispatch a single MCP tool call.
 *
 * Layered enforcement, in order:
 *   1. tool exists                                → METHOD_NOT_FOUND
 *   2. ctx.scopes ⊇ {tool.scope}                  → SCOPE_DENIED
 *   3. ctx.mcpTools includes toolId               → ALLOWLIST_DENIED
 *   4. rate-limit bucket for (tokenId, toolId)    → RATE_LIMITED
 *   5. tool.inputSchema.parse(args)               → INVALID_PARAMS
 *   6. tool.handler(ctx, args)                    → success | ACL_DENIED | INTERNAL_ERROR
 *
 * NOTE: this function NEVER imports the page-ACL helper. ACL enforcement is the
 * responsibility of the underlying library helper the handler calls. The
 * dispatcher only translates the library's HttpError(403)/HttpError(404) into
 * the MCP-domain ACL_DENIED code.
 */
export async function dispatchTool(
  ctx: TokenContext,
  toolId: string,
  args: unknown,
): Promise<unknown> {
  const tool = toolMap.get(toolId);
  if (!tool) {
    const err = mcpError(MCP_ERROR_CODE.METHOD_NOT_FOUND, 'unknown tool', { tool: toolId });
    await logUsage(ctx, toolId, statusForCode(err.code));
    throw err;
  }

  // Admin scope supersedes per-resource scopes (spec §3 G1).
  const hasScope = ctx.scopes.includes(tool.scope) || ctx.scopes.includes('admin');
  if (!hasScope) {
    const err = mcpError(MCP_ERROR_CODE.SCOPE_DENIED, `missing scope ${tool.scope}`, {
      required: tool.scope,
    });
    await logUsage(ctx, toolId, statusForCode(err.code));
    throw err;
  }

  if (!ctx.mcpTools.includes(toolId)) {
    const err = mcpError(MCP_ERROR_CODE.ALLOWLIST_DENIED, 'tool not in PAT allowlist', {
      tool: toolId,
    });
    await logUsage(ctx, toolId, statusForCode(err.code));
    throw err;
  }

  if (!consumeToken(`${ctx.tokenId}:${toolId}`)) {
    const err = mcpError(MCP_ERROR_CODE.RATE_LIMITED, 'rate limit exceeded', { tool: toolId });
    await logUsage(ctx, toolId, statusForCode(err.code));
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = tool.inputSchema.parse(args);
  } catch (err) {
    const mErr = toMcpError(err);
    await logUsage(ctx, toolId, statusForCode(mErr.code));
    throw mErr;
  }

  try {
    const result = await tool.handler(ctx, parsed);
    await logUsage(ctx, toolId, 200);
    return result;
  } catch (err) {
    const mErr = toMcpError(err);
    await logUsage(ctx, toolId, statusForCode(mErr.code));
    throw mErr;
  }
}
