import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { ACTIVE_WORKSPACE_COOKIE, getAuthContext, HttpError } from '@/lib/auth/require-role';
import { AcceptInviteError, acceptInvite } from '@/lib/workspaces/accept-invite';

const AcceptInput = z.object({ token: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new HttpError(401, 'Not authenticated');
    const parsed = AcceptInput.parse(await req.json().catch(() => ({})));

    const [user] = await getDb()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.userId))
      .limit(1);
    if (!user) throw new HttpError(401, 'Not authenticated');

    const result = await acceptInvite(getDb(), {
      token: parsed.token,
      userId: ctx.userId,
      userEmail: user.email,
    });

    const store = await cookies();
    store.set(ACTIVE_WORKSPACE_COOKIE, result.workspaceId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });

    return NextResponse.json({ ok: true, workspaceId: result.workspaceId }, { status: 200 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof AcceptInviteError) {
      const status = err.code === 'EMAIL_MISMATCH' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
