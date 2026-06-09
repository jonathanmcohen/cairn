import { buildResourceMetadata } from '@/lib/oauth/metadata';
import { publicOrigin } from '@/lib/url';

// publicOrigin() reads the incoming request via next/headers.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /.well-known/oauth-protected-resource — RFC 9728 protected-resource
 * metadata for `/api/mcp`. The `WWW-Authenticate: Bearer resource_metadata=…`
 * header on the unauthenticated MCP 401 points here; this names Cairn as the
 * authorization server the client should discover next.
 */
export async function GET(): Promise<Response> {
  const origin = await publicOrigin();
  return Response.json(buildResourceMetadata(origin), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
