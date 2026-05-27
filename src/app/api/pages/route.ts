import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createPage } from '@/lib/pages/create';
import { maybePurge } from '@/lib/pages/maybe-purge';
import { requireSpaceAccess } from '@/lib/spaces/access';

const CreateInput = z.object({
  parentId: z.uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).optional(),
  // v0.9.0 G2 P11 — optional space to file the new page under.
  spaceId: z.uuid().nullable().optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    maybePurge();
    const ctx = await requireRole('editor');
    const parsed = CreateInput.parse(await req.json().catch(() => ({})));
    // v0.9.0 G2 P11 — when filing the new page under a space, the caller
    // must reach `editor` on that space (ACL chain). Cross-workspace spaceId
    // → 404 via requireSpaceAccess existence-hiding.
    if (parsed.spaceId) {
      const access = await requireSpaceAccess(getDb(), {
        spaceId: parsed.spaceId,
        userId: ctx.userId,
        minRole: 'editor',
        workspaceId: ctx.workspaceId,
      });
      if (!access.ok) {
        return NextResponse.json(
          { error: access.code },
          { status: access.code === 'not_found' ? 404 : 403 },
        );
      }
    }
    const page = await createPage(getDb(), {
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      parentId: parsed.parentId,
      title: parsed.title,
      icon: parsed.icon ?? null,
      spaceId: parsed.spaceId ?? null,
    });
    return NextResponse.json(page, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/workspace/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
