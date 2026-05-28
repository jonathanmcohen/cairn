import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, hasMinRole } from '@/lib/auth/require-role';
import { markdownToProse } from '@/lib/markdown/to-prose';
import { requirePageAccess } from '@/lib/pages/access';
import { updatePage } from '@/lib/pages/update';

const Input = z.object({ markdown: z.string().max(5_000_000) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const { markdown } = Input.parse(await req.json());
    const content = markdownToProse(markdown);
    const updated = await updatePage(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      patch: { content },
      // v0.9.0 G2 P14 — page-lock gate.
      byUserId: ctx.userId,
      adminOverride: hasMinRole(ctx.role, 'admin'),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof HttpError) {
      // v0.9.0 G2 P14 review — PageLockedError extends HttpError; carry its
      // optional `code`/`state` through when present.
      const body: { error: string; code?: string; state?: unknown } = { error: err.message };
      const maybe = err as { code?: string; state?: unknown };
      if (typeof maybe.code === 'string') body.code = maybe.code;
      if (maybe.state !== undefined) body.state = maybe.state;
      return NextResponse.json(body, { status: err.status });
    }
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
