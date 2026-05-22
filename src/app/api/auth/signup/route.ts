import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getDb } from '@/db/client';
import { SignupInput, signup } from '@/lib/auth/signup';
import { ipKey, signupLimiter } from '@/lib/security/rate-limit';

export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const email =
    typeof (payload as { email?: unknown })?.email === 'string'
      ? (payload as { email: string }).email.toLowerCase()
      : 'anon';
  const rl = signupLimiter.check(ipKey(req, email));
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Too many attempts' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)),
      },
    });
  }
  try {
    const input = SignupInput.parse(payload);
    const result = await signup(getDb(), input);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (/invite/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
