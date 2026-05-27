import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { workspaceEncryptionKeys, workspaces } from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { assertCoverageAndKeypairs } from '@/lib/e2e/wsk-server';

/**
 * v0.9.0 G1 P7 — POST /api/workspaces/[id]/e2e/enable.
 *
 * Owner-only flip from `e2eMode === 'off'` to `'workspace_wide'`. The caller
 * submits a roster of wrapped workspace-keys (one per current member); the
 * server validates:
 *   - caller is owner of the URL workspace,
 *   - workspace.e2eMode is currently 'off',
 *   - the roster covers every current member exactly once,
 *   - each named member has a registered keypair.
 *
 * Side effects (one transaction):
 *   - INSERT one workspace_encryption_keys row per member at key_version=1,
 *   - UPDATE workspaces.e2eMode = 'workspace_wide',
 *   - APPEND `e2e.workspace.encrypted` audit row.
 *
 * The server NEVER sees the unwrapped WSK or any plaintext page content. The
 * page-sweep step runs as a separate sequence of
 * /api/pages/[pageId]/encrypt-under-wsk calls (Task 6).
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

const Body = z.object({
  wrapped: z
    .array(
      z.object({
        memberUserId: z.uuid(),
        wrappedWsk: z.string().min(1),
      }),
    )
    .min(1),
});

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { id: workspaceId } = await params;
    const ctx = await requireRole('owner');
    if (ctx.workspaceId !== workspaceId) {
      // Cross-workspace request → 404 (existence-leak guard).
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }

    const db = getDb();
    const [wsPre] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!wsPre) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (wsPre.e2eMode !== 'off') {
      return NextResponse.json({ error: 'workspace already has E2E enabled' }, { status: 409 });
    }

    const coverage = await assertCoverageAndKeypairs(db, workspaceId, parsed.data.wrapped);
    if (!coverage.ok) {
      return NextResponse.json({ error: coverage.error }, { status: coverage.status });
    }

    const txResult = await db.transaction(async (tx) => {
      // Re-check workspace state INSIDE the tx to close the read-then-write
      // race between the outer SELECT and the UPDATE below; a concurrent enable
      // would otherwise be able to overwrite our roster.
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      if (!ws) return { status: 404 as const, body: { error: 'not found' } };
      if (ws.e2eMode !== 'off') {
        return {
          status: 409 as const,
          body: { error: 'workspace already has E2E enabled' },
        };
      }
      for (const w of parsed.data.wrapped) {
        const wrappedBuf = Buffer.from(w.wrappedWsk, 'base64');
        // Idempotent: re-enable rewraps cleanly if a stale row exists.
        await tx
          .insert(workspaceEncryptionKeys)
          .values({
            workspaceId,
            memberUserId: w.memberUserId,
            wrappedWsk: wrappedBuf,
            keyVersion: 1,
          })
          .onConflictDoUpdate({
            target: [workspaceEncryptionKeys.workspaceId, workspaceEncryptionKeys.memberUserId],
            set: { wrappedWsk: wrappedBuf, keyVersion: 1, createdAt: new Date() },
          });
      }
      await tx
        .update(workspaces)
        .set({ e2eMode: 'workspace_wide' })
        .where(eq(workspaces.id, workspaceId));
      await recordAudit(tx, {
        workspaceId,
        actorUserId: ctx.userId,
        action: 'e2e.workspace.encrypted',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { memberCount: parsed.data.wrapped.length, keyVersion: 1 },
      });
      return { status: 200 as const, body: { ok: true } };
    });

    if (txResult.status !== 200) {
      return NextResponse.json(txResult.body, { status: txResult.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Generic 400 for any other failure path (don't leak crypto/db internals).
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
