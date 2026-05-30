import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { auth } from '@/lib/auth/config';
import { listActiveSessions } from '@/lib/auth/session-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → the caller's active sessions, with the current device flagged. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const sid = (session as { sid?: string }).sid;
  const rows = await listActiveSessions(getDb(), session.user.id);
  const sessions = rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    current: s.id === sid,
  }));
  return NextResponse.json({ sessions });
}
