import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { auth } from '@/lib/auth/config';
import { beginEnrollment, confirmEnrollment } from '@/lib/auth/two-factor';
import { env } from '@/lib/env';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const out = await beginEnrollment(getDb(), {
    userId: session.user.id,
    account: session.user.email,
    key: env().AUTH_SECRET,
  });
  return NextResponse.json(out);
}

const ConfirmSchema = z.object({ token: z.string().min(6).max(8) });

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const parsed = ConfirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const ok = await confirmEnrollment(getDb(), {
    userId: session.user.id,
    token: parsed.data.token,
    key: env().AUTH_SECRET,
  });
  if (!ok) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  return NextResponse.json({ enabled: true });
}
