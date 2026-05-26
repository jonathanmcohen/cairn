import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  requireMfa: z.boolean(),
  methods: z.array(z.enum(['totp', 'webauthn'])).min(1),
});

/**
 * GET /api/admin/workspaces/:workspaceId/mfa-policy
 *
 * Reads the current policy. Returns the default (requireMfa=false,
 * methods=['totp','webauthn']) shape when no row exists, so the admin UI
 * doesn't need an existence check.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
): Promise<Response> {
  const { workspaceId } = await params;
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Cross-workspace guard: 404 (not 403) when the path workspace doesn't
  // match the requester's active workspace — never leak existence.
  if (ctx.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.workspaceMfaPolicies)
    .where(eq(schema.workspaceMfaPolicies.workspaceId, workspaceId))
    .limit(1);
  return NextResponse.json({
    requireMfa: row?.requireMfa ?? false,
    methods: row?.methods ?? ['totp', 'webauthn'],
  });
}

/**
 * PUT /api/admin/workspaces/:workspaceId/mfa-policy
 *
 * Admin-only upsert of the per-workspace MFA enforcement policy. Records
 * `mfa.policy_changed` inside the same transaction so the audit row can
 * never drift from the policy write.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
): Promise<Response> {
  const { workspaceId } = await params;
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (ctx.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.workspaceMfaPolicies)
      .values({
        workspaceId,
        requireMfa: parsed.data.requireMfa,
        methods: parsed.data.methods,
      })
      .onConflictDoUpdate({
        target: schema.workspaceMfaPolicies.workspaceId,
        set: {
          requireMfa: parsed.data.requireMfa,
          methods: parsed.data.methods,
          updatedAt: sql`now()`,
        },
      });

    await recordAudit(tx, {
      workspaceId,
      actorUserId: ctx.userId,
      action: 'mfa.policy_changed',
      targetType: 'mfa_policy',
      targetId: workspaceId,
      metadata: { requireMfa: parsed.data.requireMfa, methods: parsed.data.methods },
    });
  });
  return NextResponse.json({ ok: true });
}
