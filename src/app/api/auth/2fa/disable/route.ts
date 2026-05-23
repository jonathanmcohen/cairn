import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { auth } from '@/lib/auth/config';
import { disableTwoFactor, verifySecondFactor } from '@/lib/auth/two-factor';
import { env } from '@/lib/env';

const DisableSchema = z.object({ code: z.string().min(6) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const parsed = DisableSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const db = getDb();
  const ok = await verifySecondFactor(db, {
    userId: session.user.id,
    code: parsed.data.code,
    key: env().AUTH_SECRET,
  });
  if (!ok) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  await disableTwoFactor(db, session.user.id);
  return NextResponse.json({ disabled: true });
}
