import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { maybePurge } from '@/lib/pages/maybe-purge';
import { listTrash } from '@/lib/pages/trash';

export async function GET(): Promise<Response> {
  try {
    maybePurge();
    const ctx = await requireRole('viewer');
    const entries = await listTrash(getDb(), ctx.workspaceId);
    return NextResponse.json({ entries });
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
