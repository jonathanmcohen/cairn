import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { requireRole } from '@/lib/auth/require-role';
import { mintScimToken } from '@/lib/sso/scim-token';

export const dynamic = 'force-dynamic';

const VALID_SCOPES = new Set(['users:read', 'users:write', 'groups:read', 'groups:write']);

const Body = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).refine((arr) => arr.every((s) => VALID_SCOPES.has(s)), {
    message: 'unknown scope',
  }),
});

export async function GET(): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Note: SELECT excludes tokenHash so the admin list never echoes the
  // sha256 hash — it stays in the DB row only.
  const rows = await getDb()
    .select({
      id: schema.scimTokens.id,
      name: schema.scimTokens.name,
      scopes: schema.scimTokens.scopes,
      createdBy: schema.scimTokens.createdBy,
      createdAt: schema.scimTokens.createdAt,
      lastUsedAt: schema.scimTokens.lastUsedAt,
    })
    .from(schema.scimTokens)
    .where(eq(schema.scimTokens.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.scimTokens.createdAt));
  return NextResponse.json({ items: rows });
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const json = await req.json().catch((err: unknown) => {
    console.error('[admin/sso/scim-tokens] body parse error', err);
    return null;
  });
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { raw, hash } = mintScimToken();
  const db = getDb();
  try {
    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.scimTokens)
        .values({
          workspaceId: ctx.workspaceId,
          tokenHash: hash,
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          createdBy: ctx.userId,
        })
        .returning({ id: schema.scimTokens.id });

      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'sso.scim.token.minted',
        targetType: 'scim_token',
        targetId: row!.id,
        metadata: { name: parsed.data.name, scopes: parsed.data.scopes },
      });
      return row!.id;
    });

    // Show the raw token exactly once — the response is the only time it
    // exists outside the requesting browser. The DB stores only the hash.
    return NextResponse.json(
      {
        id: inserted,
        raw,
        tokenHashPrefix: hash.slice(0, 8),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[admin/sso/scim-tokens] mint transaction failed', err);
    return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 });
  }
}
