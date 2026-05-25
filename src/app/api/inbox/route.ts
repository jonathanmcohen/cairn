import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { captureInbox, type InboxCapturePayload } from '@/lib/inbox/capture';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JsonBody = z.object({
  title: z.string().max(500).optional().default(''),
  body: z.string().max(50_000).optional().default(''),
  url: z.url().nullable().optional().default(null),
});

type ReadResult =
  | { ok: true; payload: InboxCapturePayload }
  | { ok: false; status: number };

async function readPayload(req: Request): Promise<ReadResult> {
  const contentType = req.headers.get('content-type') ?? '';
  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    // Share-sheet POST: PWA manifest's share_target.params keys are
    // `title` / `text` / `url`. Map `text` → body so the same downstream
    // shape applies.
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { ok: false, status: 400 };
    }
    const rawUrl = form.get('url');
    const url = typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
    const titleField = form.get('title');
    const textField = form.get('text');
    return {
      ok: true,
      payload: {
        title: typeof titleField === 'string' ? titleField.slice(0, 500) : '',
        body: typeof textField === 'string' ? textField.slice(0, 50_000) : '',
        url,
      },
    };
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, status: 400 };
  }
  const parsed = JsonBody.safeParse(json);
  if (!parsed.success) return { ok: false, status: 400 };
  return {
    ok: true,
    payload: {
      title: parsed.data.title,
      body: parsed.data.body,
      url: parsed.data.url ?? null,
    },
  };
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (!ctx?.userId || !ctx.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const read = await readPayload(req);
  if (!read.ok) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: read.status });
  }

  const result = await captureInbox(getDb(), {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    payload: read.payload,
  });
  return NextResponse.json(result, { status: 201 });
}
