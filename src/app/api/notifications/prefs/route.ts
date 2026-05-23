import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { getEmailPrefs, NOTIFICATION_TYPES, setEmailPref } from '@/lib/email/prefs';
import { emailEnabled } from '@/lib/email/transport';

const PutBody = z.object({
  notificationType: z.enum(NOTIFICATION_TYPES),
  emailEnabled: z.boolean(),
  digestOnly: z.boolean(),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const prefs = await getEmailPrefs(getDb(), ctx.userId, ctx.workspaceId);
    return NextResponse.json({ prefs, emailEnabled: emailEnabled() });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const body = PutBody.parse(await req.json());
    await setEmailPref(getDb(), {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      notificationType: body.notificationType,
      emailEnabled: body.emailEnabled,
      digestOnly: body.digestOnly,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
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
