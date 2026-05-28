import type { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { exportWorkspace, StaticExportError } from '@/lib/export/static-site';

const Body = z.object({
  workspaceId: z.uuid(),
  target: z.enum(['mkdocs', 'docusaurus']),
});

/**
 * POST /api/exports/static-site
 *
 * Streams a ZIP archive containing a buildable static-site project (v0.9.0
 * G7 P34). Admin-only; refuses workspaces that contain any encrypted page.
 *
 * Body: `{ workspaceId: uuid, target: 'mkdocs' | 'docusaurus' }`
 * Response: `application/zip` + `Content-Disposition: attachment; filename=...`
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const json = await req.json();
    const body = Body.parse(json);
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== body.workspaceId) {
      // The active-workspace cookie governs which workspace `requireRole`
      // returns; a body workspaceId that doesn't match is a cross-tenant
      // attempt and gets the same opaque 404 used by /pages.
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const stream = await exportWorkspace(getDb(), {
      workspaceId: body.workspaceId,
      target: body.target,
    });
    // Node Readable → web Response — Next 16 accepts it at runtime but the
    // type still mismatches (see CLAUDE.md "Gotchas" §Node Readable).
    // @ts-expect-error — runtime works; type lies.
    return new Response(stream as Readable, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="cairn-${body.workspaceId.slice(0, 8)}-${body.target}.zip"`,
      },
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof StaticExportError) {
      const status = err.code === 'workspace_not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
