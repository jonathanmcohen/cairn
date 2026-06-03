import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { updateUserProfile } from '@/lib/users/profile';

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  // Accept either an absolute URL or the relative signed-file path that
  // storeUpload returns (`/api/files/<id>?sig=&exp=`), or null to clear.
  avatarUrl: z
    .string()
    .max(2048)
    .refine((v) => v.startsWith('/') || /^https?:\/\//.test(v), {
      message: 'avatarUrl must be an absolute URL or a leading-slash path',
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: Request): Promise<Response> {
  try {
    // Any signed-in member may edit their own profile. requireRole throws
    // HttpError(401) when there is no session (covers the unauthenticated case).
    const ctx = await requireRole('viewer');
    const body = PatchBody.parse(await req.json().catch(() => ({})));
    const user = await updateUserProfile(getDb(), { userId: ctx.userId, ...body });
    return NextResponse.json({ id: user.id, name: user.name, avatarUrl: user.avatarUrl });
  } catch (err) {
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    const message = err instanceof Error ? err.message : 'unknown';
    if (/name|no fields/i.test(message))
      return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
