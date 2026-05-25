import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { markInboxDone } from '@/lib/inbox/triage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  const session = await getAuthContext();
  if (!session?.userId || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { pageId } = await ctx.params;
  try {
    await markInboxDone(getDb(), {
      pageId,
      workspaceId: session.workspaceId,
      userId: session.userId,
    });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
