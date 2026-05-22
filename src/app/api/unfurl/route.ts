import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth/require-role';
import { parseOgTags } from '@/lib/editor/og-parse';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';

export const runtime = 'nodejs';

const QuerySchema = z.object({ url: z.url() });

const MAX_BYTES = 512 * 1024; // 512 KiB head budget — bookmarks need only <head>.
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

/** Fetch with a manual-redirect loop so EVERY hop is SSRF-re-checked. */
async function guardedFetch(rawUrl: string): Promise<{ html: string; finalUrl: string } | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current); // throws on private/loopback/rebind/non-http(s)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html', 'user-agent': 'cairn-unfurl/1.0' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('text/html') && !ctype.includes('application/xhtml')) return null;
    // Read at most MAX_BYTES.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total >= MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }
    const html = new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return { html, finalUrl: current };
  }
  return null; // too many redirects
}

export async function GET(req: Request): Promise<Response> {
  // Authenticated workspace users only — not an anonymous proxy.
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = QuerySchema.safeParse({ url: new URL(req.url).searchParams.get('url') });
  if (!parsed.success) return NextResponse.json({ error: 'invalid url' }, { status: 400 });

  try {
    const fetched = await guardedFetch(parsed.data.url);
    if (!fetched) return NextResponse.json({ error: 'could not fetch' }, { status: 422 });
    const meta = parseOgTags(fetched.html, fetched.finalUrl);
    return NextResponse.json({ url: parsed.data.url, ...meta });
  } catch (err) {
    // assertPublicUrl throws for blocked/internal hosts → refuse without leaking which.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'refused' },
      { status: 400 },
    );
  }
}
