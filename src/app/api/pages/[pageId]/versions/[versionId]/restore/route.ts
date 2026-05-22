import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { listVersions, restoreVersion } from '@/lib/pages/versions';

type RouteCtx = { params: Promise<{ pageId: string; versionId: string }> };

export async function POST(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId, versionId } = await params;
    await requirePageAccess(pageId, 'editor');
    // the version must belong to this page (avoid cross-page restore)
    const owned = (await listVersions(getDb(), pageId)).some((v) => v.id === versionId);
    if (!owned) return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    const restored = await restoreVersion(getDb(), versionId);
    return NextResponse.json(restored);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
