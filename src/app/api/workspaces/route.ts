import { getDb } from '@/db/client';
import { ACTIVE_WORKSPACE_COOKIE, HttpError, getAuthContext } from '@/lib/auth/require-role';
import { createWorkspace } from '@/lib/workspaces/create';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const CreateInput = z.object({ name: z.string().min(1).max(120) });

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new HttpError(401, 'Not authenticated');
    const parsed = CreateInput.parse(await req.json().catch(() => ({})));
    const ws = await createWorkspace(getDb(), { name: parsed.name, ownerUserId: ctx.userId });

    const store = await cookies();
    store.set(ACTIVE_WORKSPACE_COOKIE, ws.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });

    return NextResponse.json(ws, { status: 201 });
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
