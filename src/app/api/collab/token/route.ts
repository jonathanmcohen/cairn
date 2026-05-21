import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth/require-role';
import { mintCollabToken } from '@/lib/collab/token';
import { env } from '@/lib/env';
import { requirePageAccess } from '@/lib/pages/access';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pageId = url.searchParams.get('pageId');
  if (!pageId) {
    return NextResponse.json({ error: 'pageId is required' }, { status: 400 });
  }

  try {
    // 'viewer' is the floor; the resolved ctx.role is the caller's actual page role.
    const { ctx } = await requirePageAccess(pageId, 'viewer');
    const token = mintCollabToken({
      userId: ctx.userId,
      pageId,
      role: ctx.role,
      secret: env().AUTH_SECRET,
    });
    return NextResponse.json({ token, collabUrl: env().COLLAB_URL });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
