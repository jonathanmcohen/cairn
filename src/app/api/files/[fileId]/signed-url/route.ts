import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { signFileUrl } from '@/lib/files/signing';
import { requirePageAccess } from '@/lib/pages/access';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ fileId: string }> };

const FileId = z.uuid();
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Mint a short-lived signed URL for the given file. Used by the PDF viewer
 * (v0.9.0 G3 P17) — the renderer needs the URL up-front so `pdfjs.getDocument`
 * can stream the blob without re-uploading. Access is gated by
 * `requirePageAccess` against the file's owning page so cross-workspace
 * fetches return 404, matching the convention elsewhere.
 *
 * Encrypted-page guard: if the owning page is in E2E mode (`pages.encrypted =
 * true`) we refuse — the file blob layer doesn't carry the page DEK and
 * shipping the bare bytes to the browser would defeat E2E for any future
 * encrypted-file work. PDFs themselves aren't encrypted at rest in v0.9, but
 * the refusal keeps the contract consistent so a later E2E-file feature
 * doesn't accidentally leak.
 */
export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { fileId } = await params;
    if (!FileId.safeParse(fileId).success) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
    if (!file?.pageId) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { page } = await requirePageAccess(file.pageId, 'viewer');
    if (page.encrypted) {
      return NextResponse.json(
        { error: 'file is on an encrypted page; signed URLs are not minted' },
        { status: 403 },
      );
    }
    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const sig = signFileUrl({ fileId, expiresAt, secret: env().AUTH_SECRET });
    const url = `/api/files/${fileId}?sig=${sig}&exp=${expiresAt}`;
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
