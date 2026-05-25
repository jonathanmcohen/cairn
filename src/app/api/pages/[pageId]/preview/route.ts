import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';

const Params = z.object({ pageId: z.uuid() });

/**
 * Walk the ProseMirror JSON doc and return the joined text of the first
 * top-level paragraph, capped at 280 chars. Used by the page-link hover
 * popover to render a tiny preview without paying the full page payload.
 */
function firstParagraphFromContent(content: unknown): string {
  if (!content || typeof content !== 'object' || !('content' in content)) return '';
  const top = (content as { content: unknown }).content;
  if (!Array.isArray(top)) return '';
  for (const node of top) {
    if (!node || typeof node !== 'object') continue;
    if ((node as { type?: string }).type !== 'paragraph') continue;
    const inner = (node as { content?: unknown }).content;
    if (!Array.isArray(inner)) return '';
    const text = inner
      .map((leaf) =>
        leaf && typeof leaf === 'object' && 'text' in leaf
          ? String((leaf as { text: unknown }).text)
          : '',
      )
      .join('');
    return text.slice(0, 280);
  }
  return '';
}

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = Params.parse(await params);
    const { page } = await requirePageAccess(pageId, 'viewer');
    return NextResponse.json({
      title: page.title,
      // The schema column is `icon` (free-form emoji or URL).
      icon: page.icon ?? null,
      firstParagraph: firstParagraphFromContent(page.content),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
