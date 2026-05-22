import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth/require-role';
import { mintCollabToken } from '@/lib/collab/token';
import { env } from '@/lib/env';
import { requirePageAccess } from '@/lib/pages/access';
import { collabTokenLimiter, ipKey } from '@/lib/security/rate-limit';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pageId = url.searchParams.get('pageId');
  if (!pageId) {
    return NextResponse.json({ error: 'pageId is required' }, { status: 400 });
  }

  try {
    // 'viewer' is the floor; the resolved ctx.role is the caller's actual page role.
    const { ctx } = await requirePageAccess(pageId, 'viewer');
    const rl = collabTokenLimiter.check(ipKey(req, ctx.userId));
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      });
    }
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
