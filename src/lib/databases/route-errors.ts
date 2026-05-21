import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HttpError } from '@/lib/auth/require-role';

export function errToResponse(err: unknown): Response {
  if (err instanceof HttpError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError)
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  const msg = err instanceof Error ? err.message : 'unknown';
  if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
  if (/workspace|requires|kanban/i.test(msg))
    return NextResponse.json({ error: msg }, { status: 400 });
  return NextResponse.json({ error: msg }, { status: 500 });
}
