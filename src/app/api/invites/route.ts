import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createInvite } from '@/lib/workspaces/invites';

const CreateInvite = z.object({
  email: z.email(),
  role: z.enum(['admin', 'editor', 'viewer']),
  expiresInDays: z.number().int().positive().max(30).default(7),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = CreateInvite.parse(await req.json());
    const { invite, token } = await createInvite(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      email: parsed.email,
      role: parsed.role,
      expiresInDays: parsed.expiresInDays,
    });
    // The raw token is returned ONCE here (for the share link) and never persisted
    // in the audit log — see createInvite.
    return NextResponse.json(
      {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token,
        expiresAt: invite.expiresAt,
      },
      { status: 201 },
    );
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
