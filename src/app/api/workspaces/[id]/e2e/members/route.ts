import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { userKeypairs, users, workspaceMembers } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * v0.9.7 G21 (#168) — GET /api/workspaces/[id]/e2e/members.
 *
 * Owner-only roster for the rekey UI: every current member with display
 * name/email and whether they have an enrolled keypair (so the UI can warn
 * before a rekey that would 409 on an unenrolled member). Returns NO key
 * material — the boolean `hasKeypair` is derived server-side from the presence
 * of a user_keypairs row, never the key itself.
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { id: workspaceId } = await params;
    const ctx = await requireRole('owner');
    if (ctx.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const rows = await db
      .select({
        userId: workspaceMembers.userId,
        name: users.name,
        email: users.email,
        keypairUserId: userKeypairs.userId,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(userKeypairs, eq(userKeypairs.userId, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return NextResponse.json(
      rows.map((r) => ({
        userId: r.userId,
        name: r.name,
        email: r.email,
        hasKeypair: r.keypairUserId !== null,
      })),
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
