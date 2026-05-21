import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { streamSubtreeZip } from '@/lib/markdown/export-subtree';
import { proseToMarkdown } from '@/lib/markdown/from-prose';
import { requirePageAccess } from '@/lib/pages/access';
import { NextResponse } from 'next/server';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'viewer');
    const url = new URL(req.url);
    const recursive = url.searchParams.get('recursive') === 'true';

    if (recursive) {
      const stream = await streamSubtreeZip(getDb(), {
        workspaceId: ctx.workspaceId,
        rootPageId: page.id,
      });
      // @ts-expect-error: Node Readable → web Response works in Next 15
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${page.title || 'export'}.zip"`,
        },
      });
    }

    const md = proseToMarkdown(page.content);
    return new Response(md, {
      status: 200,
      headers: {
        'content-type': 'text/markdown',
        'content-disposition': `attachment; filename="${page.title || 'page'}.md"`,
      },
    });
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
