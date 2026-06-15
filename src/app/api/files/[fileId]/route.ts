import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { getStorage } from '@/lib/files/get-storage';
import { verifyFileUrl } from '@/lib/files/signing';
import { getStorageFor } from '@/lib/files/storage-config';

const FileId = z.uuid();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await params;
  const url = new URL(req.url);
  const sig = url.searchParams.get('sig');
  const exp = Number(url.searchParams.get('exp'));
  if (!sig || !exp) return NextResponse.json({ error: 'missing signature' }, { status: 401 });

  const ok = verifyFileUrl({ fileId, expiresAt: exp, sig, secret: env().AUTH_SECRET });
  if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });

  // Reject ids that are not well-formed UUIDs before they reach the DB: a
  // non-UUID id (e.g. a path-traversal payload) would otherwise throw an
  // uncaught query error. Treat as not-found to avoid leaking existence/shape.
  if (!FileId.safeParse(fileId).success) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const [f] = await getDb().select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
  if (!f) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // v0.10.3 CFG-2 — read from the DB-configured S3 backend when uploads are
  // opted in; otherwise fall back to the legacy local default (never null).
  const storage = (await getStorageFor(getDb(), 'uploads')) ?? getStorage();
  // @ts-expect-error: Node Readable → web Response works at runtime in Next 16
  return new Response(storage.read(f.path), {
    status: 200,
    headers: {
      'content-type': f.mimeType,
      'content-length': String(f.size),
      'cache-control': 'private, max-age=300',
    },
  });
}
