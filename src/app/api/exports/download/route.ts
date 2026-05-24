import { basename } from 'node:path';
import { env } from '@/lib/env';
import { getStorage } from '@/lib/files/get-storage';
import { verifyFileUrl } from '@/lib/files/signing';

export const runtime = 'nodejs';

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Signed download for a workspace export archive previously mirrored to
 * FileStorage by `POST /api/exports`. The signature is verified against the
 * AUTH_SECRET (the same HMAC primitive used for file reads); no session is
 * required because the URL itself is the bearer credential and is intended for
 * direct-from-browser download (e.g. `<a href=...>`).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const sig = url.searchParams.get('sig');
  const expRaw = url.searchParams.get('exp');
  if (!key || !sig || !expRaw) return jsonError(401, 'unsigned');
  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt)) return jsonError(401, 'invalid exp');

  // Restrict to the backups/ prefix so a leaked signer can't be aimed at
  // arbitrary FileStorage keys (e.g. someone else's uploaded image blob).
  if (!key.startsWith('backups/')) return jsonError(401, 'invalid key');

  const ok = verifyFileUrl({ fileId: key, expiresAt, sig, secret: env().AUTH_SECRET });
  if (!ok) return jsonError(401, 'invalid signature');

  const storage = getStorage();
  const stream = storage.read(key);
  // Node's Readable doesn't satisfy the web ReadableStream type the Response
  // constructor expects, but Next 16 accepts it at runtime. The same dance
  // exists in src/app/api/files/[fileId]/route.ts.
  return new Response(
    // @ts-expect-error — Node Readable → web ReadableStream at runtime
    stream,
    {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${basename(key)}"`,
      },
    },
  );
}
