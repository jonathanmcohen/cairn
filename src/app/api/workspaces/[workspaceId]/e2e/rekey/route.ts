import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { pages, workspaceEncryptionKeys, workspaces } from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { assertCoverageAndKeypairs, getCurrentKeyVersion } from '@/lib/e2e/wsk-server';

/**
 * v0.9.0 G1 P7 — POST /api/workspaces/[workspaceId]/e2e/rekey.
 *
 * Owner-only. After removing a workspace member (or any time the admin wants
 * to rotate the WSK), the client:
 *   1. mints a fresh 32-byte WSK,
 *   2. wraps it under every REMAINING member's public key,
 *   3. re-encrypts every encrypted-under-WSK page locally,
 *   4. POSTs the wrapped roster + ciphertext bundles here.
 *
 * Server validates: caller is owner; mode is 'workspace_wide'; the wrapped
 * roster covers every current workspace member exactly once + each has a
 * registered keypair. One transaction:
 *   - audit `e2e.workspace.member_removed` if `removedMemberId` is set
 *   - audit `e2e.workspace.rekey_started`
 *   - DELETE all workspace_encryption_keys rows for this workspace
 *   - INSERT one row per current member at key_version = previous + 1
 *   - UPDATE each named page's content_encrypted (blanks plaintext columns)
 *   - audit `e2e.workspace.rekey_completed`
 *
 * The server NEVER sees the unwrapped WSK or any page plaintext.
 *
 * Idempotency: a retry that re-submits the same key_version's roster will
 * fail (PK conflict on workspace_encryption_keys after the DELETE + INSERT,
 * since each call increments). Clients should treat a 200 as terminal and
 * not retry the same call twice.
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ workspaceId: string }> };

const Body = z.object({
  wrapped: z
    .array(
      z.object({
        memberUserId: z.uuid(),
        wrappedWsk: z.string().min(1),
      }),
    )
    .min(1),
  pageBundles: z.array(
    z.object({
      pageId: z.uuid(),
      contentEncrypted: z.string().min(1),
    }),
  ),
  removedMemberId: z.uuid().nullable(),
});

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { workspaceId } = await params;
    const ctx = await requireRole('owner');
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

    const coverage = await assertCoverageAndKeypairs(db, workspaceId, parsed.data.wrapped);
    if (!coverage.ok) {
      return NextResponse.json({ error: coverage.error }, { status: coverage.status });
    }

    const prevVersion = await getCurrentKeyVersion(db, workspaceId);
    const nextVersion = prevVersion + 1;

    await db.transaction(async (tx) => {
      if (parsed.data.removedMemberId) {
        await recordAudit(tx, {
          workspaceId,
          actorUserId: ctx.userId,
          action: 'e2e.workspace.member_removed',
          targetType: 'member',
          targetId: parsed.data.removedMemberId,
          metadata: { keyVersion: prevVersion },
        });
      }
      await recordAudit(tx, {
        workspaceId,
        actorUserId: ctx.userId,
        action: 'e2e.workspace.rekey_started',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: {
          fromVersion: prevVersion,
          toVersion: nextVersion,
          pageCount: parsed.data.pageBundles.length,
        },
      });
      await tx
        .delete(workspaceEncryptionKeys)
        .where(eq(workspaceEncryptionKeys.workspaceId, workspaceId));
      await tx.insert(workspaceEncryptionKeys).values(
        parsed.data.wrapped.map((w) => ({
          workspaceId,
          memberUserId: w.memberUserId,
          wrappedWsk: Buffer.from(w.wrappedWsk, 'base64'),
          keyVersion: nextVersion,
        })),
      );
      for (const bundle of parsed.data.pageBundles) {
        await tx
          .update(pages)
          .set({
            encrypted: true,
            encryptedUnderWsk: true,
            contentEncrypted: Buffer.from(bundle.contentEncrypted, 'base64'),
            contentText: '',
            content: { type: 'doc', content: [] },
          })
          .where(and(eq(pages.id, bundle.pageId), eq(pages.workspaceId, workspaceId)));
      }
      await recordAudit(tx, {
        workspaceId,
        actorUserId: ctx.userId,
        action: 'e2e.workspace.rekey_completed',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { keyVersion: nextVersion },
      });
    });

    return NextResponse.json({ ok: true, keyVersion: nextVersion });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
