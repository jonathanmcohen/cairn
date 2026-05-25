import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { pageToPdfHtml } from '@/lib/export/pdf';
import { pageToPdf } from '@/lib/export/pdf-native';
import { pageToJson, pageToMarkdown } from '@/lib/export/renderers';
import { streamSubtreeZip } from '@/lib/markdown/export-subtree';
import { requirePageAccess } from '@/lib/pages/access';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'viewer');
    const url = new URL(req.url);
    const recursive = url.searchParams.get('recursive') === 'true';
    const format = url.searchParams.get('format') ?? 'md';
    const safeName = (page.title ?? page.id).replace(/[^\w.-]+/g, '_').slice(0, 80) || page.id;

    if (recursive) {
      const stream = await streamSubtreeZip(getDb(), {
        workspaceId: ctx.workspaceId,
        rootPageId: page.id,
      });
      // @ts-expect-error: Node Readable → web Response works at runtime in Next 16
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${page.title || 'export'}.zip"`,
        },
      });
    }

    if (format === 'json') {
      return new NextResponse(JSON.stringify(pageToJson(page), null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${safeName}.json"`,
        },
      });
    }

    // Explicit HTML-print fallback selector. Always returns the v0.6 P21
    // browser-print HTML, regardless of CAIRN_NATIVE_PDF. Lets callers force
    // the no-Chromium path when the env is set.
    if (format === 'pdf-print-html') {
      return new NextResponse(pageToPdfHtml(page), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': `inline; filename="${safeName}.html"`,
        },
      });
    }

    if (format === 'pdf') {
      if (process.env.CAIRN_NATIVE_PDF === '1') {
        const pdf = await pageToPdf(page);
        // @ts-expect-error: Node Buffer → web Response works at runtime in Next 16
        return new NextResponse(pdf, {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename="${safeName}.pdf"`,
          },
        });
      }
      // Default v0.6 P21 behaviour — return print-HTML; users save via the
      // browser print dialog.
      return new NextResponse(pageToPdfHtml(page), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': `inline; filename="${safeName}.html"`,
        },
      });
    }

    // Default: markdown (preserves prior behaviour).
    return new Response(pageToMarkdown(page), {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
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
