import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { ACTIVE_WORKSPACE_COOKIE, getAuthContext, HttpError } from '@/lib/auth/require-role';

const SwitchInput = z.object({ workspaceId: z.uuid() });

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new HttpError(401, 'Not authenticated');
    const parsed = SwitchInput.parse(await req.json().catch(() => ({})));

    const [member] = await getDb()
      .select({ workspaceId: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.userId, ctx.userId),
          eq(schema.workspaceMembers.workspaceId, parsed.workspaceId),
        ),
      )
      .limit(1);
    if (!member) throw new HttpError(403, 'Not a member of that workspace');

    const store = await cookies();
    store.set(ACTIVE_WORKSPACE_COOKIE, parsed.workspaceId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });

    return NextResponse.json({ ok: true, workspaceId: parsed.workspaceId }, { status: 200 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
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
