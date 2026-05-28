/**
 * GET /openapi.json — serves the generated OpenAPI 3.1 document.
 *
 * Workspace-member gated (any active workspace role suffices). The spec is
 * regenerated and cached per process for 1h to skip walking the manifest on
 * every request.
 */
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/require-role';
import { generateOpenApiDocument } from '@/lib/openapi/generate';

let cached: { json: string; expires: number } | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 403 });

  const now = Date.now();
  if (!cached || cached.expires < now) {
    const doc = generateOpenApiDocument();
    cached = { json: JSON.stringify(doc), expires: now + TTL_MS };
  }
  return new NextResponse(cached.json, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=3600',
    },
  });
}

/** Reset the in-process cache. Exposed for tests; not part of the public API. */
export function __resetCache(): void {
  cached = null;
}
