/**
 * GET /openapi.json — serves the generated OpenAPI 3.1 document.
 *
 * Workspace-member gated (any active workspace role suffices). The spec is
 * regenerated and cached per process for 1h to skip walking the manifest on
 * every request. The cache is keyed by public origin — the document's `servers`
 * entry varies per public host (reverse-proxied deploys differ), so a single
 * global cache would leak one host's URL to another (the MCP #37 fix).
 */
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/require-role';
import { generateOpenApiDocument } from '@/lib/openapi/generate';
import { publicOrigin } from '@/lib/url';
import { appVersion } from '@/lib/version';

const cache = new Map<string, { json: string; expires: number }>();
const TTL_MS = 60 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 403 });

  const origin = await publicOrigin();
  const now = Date.now();
  const hit = cache.get(origin);
  if (!hit || hit.expires < now) {
    const doc = generateOpenApiDocument({ serverUrl: origin, version: appVersion() });
    cache.set(origin, { json: JSON.stringify(doc), expires: now + TTL_MS });
  }
  return new NextResponse(cache.get(origin)?.json ?? '{}', {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=3600',
    },
  });
}

/** Reset the in-process cache. Exposed for tests; not part of the public API. */
export function __resetCache(): void {
  cache.clear();
}
