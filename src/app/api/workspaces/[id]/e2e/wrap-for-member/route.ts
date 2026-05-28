import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { userKeypairs, workspaceEncryptionKeys, workspaceMembers, workspaces } from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getCurrentKeyVersion } from '@/lib/e2e/wsk-server';

/**
 * v0.9.0 G1 P7 — POST /api/workspaces/[id]/e2e/wrap-for-member.
 *
 * A workspace admin (member onboarding is an admin action) unwraps the WSK
 * locally and re-wraps it under a new member's public key, then POSTs the
 * resulting ciphertext here. The server validates:
 *   - caller is admin+ of the URL workspace,
 *   - workspace is in 'workspace_wide' E2E mode,
 *   - caller has their OWN wrapped-WSK row at the current key_version (proves
 *     they could plausibly unwrap),
 *   - target is a current member of the same workspace,
 *   - target has a registered keypair.
 *
 * The upsert is idempotent: a re-wrap for a member that already has a row
 * replaces it (existence check + insert run inside a single db.transaction
 * with onConflictDoUpdate to close the check-then-insert race window).
 * Audit metadata flags `rewrapped: true` when an existing row was replaced.
 *
 * NOTE: this endpoint never inspects/decrypts the wrapped WSK; the caller's
 * "I can wrap" claim is gated only by the current-version row existing — the
 * actual ability to unwrap depends on the caller's local private-key unlock,
 * which the server cannot verify (and shouldn't try to).
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

const Body = z.object({
  memberUserId: z.uuid(),
  wrappedWsk: z.string().min(1),
});

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { id: workspaceId } = await params;
    // admin-gated: member onboarding is an admin action.
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }

    const db = getDb();
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (ws.e2eMode !== 'workspace_wide') {
      return NextResponse.json(
        { error: 'workspace is not in workspace_wide mode' },
        { status: 409 },
      );
    }

    const v = await getCurrentKeyVersion(db, workspaceId);
    const [callerRow] = await db
      .select()
      .from(workspaceEncryptionKeys)
      .where(
        and(
          eq(workspaceEncryptionKeys.workspaceId, workspaceId),
          eq(workspaceEncryptionKeys.memberUserId, ctx.userId),
        ),
      );
    if (!callerRow || callerRow.keyVersion !== v) {
      return NextResponse.json({ error: 'caller has no current-version WSK' }, { status: 403 });
    }

    // Target must be a current workspace member.
    const [target] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, parsed.data.memberUserId),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: 'target is not a workspace member' }, { status: 404 });
    }
    const [kp] = await db
      .select()
      .from(userKeypairs)
      .where(eq(userKeypairs.userId, parsed.data.memberUserId));
    if (!kp) {
      return NextResponse.json({ error: 'target has no keypair' }, { status: 409 });
    }
    const wrappedWskBuf = Buffer.from(parsed.data.wrappedWsk, 'base64');

    await db.transaction(async (tx) => {
      // Existence lookup INSIDE the tx closes the race window between check
      // and insert; the upsert below makes re-wraps idempotent.
      const [existing] = await tx
        .select()
        .from(workspaceEncryptionKeys)
        .where(
          and(
            eq(workspaceEncryptionKeys.workspaceId, workspaceId),
            eq(workspaceEncryptionKeys.memberUserId, parsed.data.memberUserId),
          ),
        );
      await tx
        .insert(workspaceEncryptionKeys)
        .values({
          workspaceId,
          memberUserId: parsed.data.memberUserId,
          wrappedWsk: wrappedWskBuf,
          keyVersion: v,
        })
        .onConflictDoUpdate({
          target: [workspaceEncryptionKeys.workspaceId, workspaceEncryptionKeys.memberUserId],
          set: {
            wrappedWsk: wrappedWskBuf,
            keyVersion: v,
            createdAt: new Date(),
          },
        });
      await recordAudit(tx, {
        workspaceId,
        actorUserId: ctx.userId,
        action: 'e2e.workspace.member_added',
        targetType: 'member',
        targetId: parsed.data.memberUserId,
        metadata: { keyVersion: v, rewrapped: Boolean(existing) },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
