import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';

const Body = z.union([z.object({ id: z.uuid() }), z.object({ all: z.literal(true) })]);

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const parsed = Body.parse(await req.json());

    // The `user_id` predicate IS the authorization: a foreign id matches zero rows.
    const owner = and(
      eq(schema.notifications.userId, ctx.userId),
      isNull(schema.notifications.readAt),
    );
    const where = 'id' in parsed ? and(owner, eq(schema.notifications.id, parsed.id)) : owner;

    const updated = await getDb()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(where)
      .returning({ id: schema.notifications.id });

    return NextResponse.json({ updated: updated.length });
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
    {
      status: 500,
    },
  );
}
