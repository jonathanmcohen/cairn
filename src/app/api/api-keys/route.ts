import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { mintKey } from '@/lib/api/keys';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const CreateKey = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(['admin', 'editor', 'viewer']),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = CreateKey.parse(await req.json());
    const expiresAt = parsed.expiresInDays
      ? new Date(Date.now() + parsed.expiresInDays * 86_400_000)
      : null;
    const { token, key } = await mintKey(getDb(), {
      workspaceId: ctx.workspaceId,
      name: parsed.name,
      role: parsed.role,
      createdBy: ctx.userId,
      expiresAt,
    });
    // Plaintext token is returned ONCE here and never persisted/retrievable again.
    return NextResponse.json(
      {
        token,
        key: {
          id: key.id,
          name: key.name,
          tokenPrefix: key.tokenPrefix,
          role: key.role,
          lastUsedAt: key.lastUsedAt,
          expiresAt: key.expiresAt,
          createdAt: key.createdAt,
        },
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
