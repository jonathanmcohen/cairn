import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const CreateInvite = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']),
  expiresInDays: z.number().int().positive().max(30).default(7),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = CreateInvite.parse(await req.json());
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + parsed.expiresInDays * 86_400_000);
    const [row] = await getDb()
      .insert(schema.inviteTokens)
      .values({
        workspaceId: ctx.workspaceId,
        email: parsed.email.toLowerCase(),
        role: parsed.role,
        token,
        expiresAt,
      })
      .returning();
    if (!row) throw new Error('Failed to create invite token');
    return NextResponse.json(
      { id: row.id, email: row.email, role: row.role, token, expiresAt },
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
