import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { getStorage } from '@/lib/files/get-storage';
import { getStorageFor } from '@/lib/files/storage-config';
import { storeUpload } from '@/lib/files/upload';
import { QuotaExceededError } from '@/lib/quotas/errors';
import { formatBytes } from '@/lib/quotas/format';

function maxUploadBytes(): number {
  // Read process.env directly so the limit can be toggled per request in tests
  // and at runtime; fall back to the validated env() default (25 MB).
  const raw = process.env.CAIRN_MAX_UPLOAD_MB;
  const mb = raw !== undefined ? Number(raw) : env().CAIRN_MAX_UPLOAD_MB;
  if (!Number.isFinite(mb) || mb <= 0) return env().CAIRN_MAX_UPLOAD_MB * 1024 * 1024;
  return mb * 1024 * 1024;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missing file field' }, { status: 400 });
    }
    const max = maxUploadBytes();
    if (file.size > max) {
      return NextResponse.json({ error: 'file too large' }, { status: 413 });
    }
    const body = Buffer.from(await file.arrayBuffer());
    // v0.10.3 CFG-2 — prefer the DB-configured S3 backend when uploads are
    // opted in; otherwise this falls back to LocalDiskStorage (never null),
    // matching the legacy getStorage() local default.
    const storage = (await getStorageFor(getDb(), 'uploads')) ?? getStorage();
    try {
      const result = await storeUpload({
        db: getDb(),
        storage,
        secret: env().AUTH_SECRET,
        workspaceId: ctx.workspaceId,
        uploadedBy: ctx.userId,
        filename: file.name,
        mimeType: file.type,
        body,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      // v0.10.0 D6 — quota breaches were falling through to the generic 500
      // branch, so users hit the cap blind. Surface a 413 with the remaining
      // headroom in human units (shared formatter, src/lib/quotas/format.ts);
      // `remainingBytes` rides along for programmatic clients.
      if (err instanceof QuotaExceededError) {
        const remainingBytes = Math.max(0, err.limit - err.used);
        return NextResponse.json(
          {
            error: `Storage quota exceeded — ${formatBytes(remainingBytes)} remaining, file is ${formatBytes(err.incoming)}`,
            remainingBytes,
          },
          { status: 413 },
        );
      }
      const message = err instanceof Error ? err.message : 'unknown';
      if (/mime/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 415 });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
