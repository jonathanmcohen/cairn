import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { testStorageConnection } from '@/lib/files/storage-config';

/**
 * POST /api/admin/object-storage-config/test — do a real PutObject+DeleteObject
 * round trip against the effective config and surface the S3 error verbatim so
 * the admin can act; does NOT mark the config healthy on failure.
 * `{ok:false, error:'not_configured'}` (400) when storage is off.
 */
export async function POST(): Promise<Response> {
  try {
    await requireRole('admin');
    const result = await testStorageConnection(getDb());
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
