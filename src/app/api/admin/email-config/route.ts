import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getEmailConfigForDisplay, saveEmailConfig, TLS_MODES } from '@/lib/email/config';

const PutBody = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  tlsMode: z.enum(TLS_MODES),
  username: z.string().nullable(),
  // Write-once: omit to keep the stored password, send a non-empty string to
  // replace it. The form never sends a blank string back.
  password: z.string().optional(),
  fromAddress: z.string().min(1),
  replyTo: z.string().nullable(),
});

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    return NextResponse.json(await getEmailConfigForDisplay(getDb()));
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const body = PutBody.parse(await req.json());
    const username = body.username?.trim() ? body.username.trim() : null;
    const replyTo = body.replyTo?.trim() ? body.replyTo.trim() : null;
    const password =
      body.password === undefined ? undefined : body.password === '' ? null : body.password;

    await saveEmailConfig(
      getDb(),
      {
        host: body.host.trim(),
        port: body.port,
        tlsMode: body.tlsMode,
        username,
        password,
        fromAddress: body.fromAddress.trim(),
        replyTo,
      },
      ctx.userId,
    );

    await recordAudit(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'config.email_updated',
      targetType: 'instance_config',
      // target_id is a uuid column; the email config is a singleton with no
      // uuid identity, so the type alone identifies it.
      metadata: { host: body.host.trim(), tlsMode: body.tlsMode },
    });

    return NextResponse.json(await getEmailConfigForDisplay(getDb()));
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
