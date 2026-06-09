import { buildAsMetadata } from '@/lib/oauth/metadata';
import { publicOrigin } from '@/lib/url';

// publicOrigin() reads the incoming request via next/headers.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 authorization-server
 * metadata. The MCP 2025-06 client fetches this after discovering the AS via the
 * protected-resource document (which it gets from the `401 WWW-Authenticate`).
 */
export async function GET(): Promise<Response> {
  const origin = await publicOrigin();
  return Response.json(buildAsMetadata(origin), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
