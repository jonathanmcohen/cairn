import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { pages, workspaces } from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';

/**
 * v0.9.0 G1 P7 — POST /api/pages/[pageId]/encrypt-under-wsk.
 *
 * Per-page sweep endpoint called once per page during the workspace-wide
 * enable flow (and from any subsequent re-key sweep that opts to re-encrypt
 * one page at a time instead of bundling). The client supplies the already-
 * encrypted ciphertext (encrypted under the WSK locally — server NEVER sees
 * the key). Server validates:
 *   - caller has editor access to the page (via requirePageAccess),
 *   - the page's workspace is in 'workspace_wide' E2E mode,
 *   - the page is not yet encrypted under WSK, OR the submitted ciphertext
 *     byte-for-byte matches the current value (idempotent retry).
 *
 * On success, sets pages.encrypted=true + encrypted_under_wsk=true, replaces
 * pages.content_encrypted, blanks content_text + content (sentinel empty doc),
 * and records an `e2e.page.encrypted` audit event (mode: 'workspace_wide').
 *
 * Idempotency: a re-call with identical ciphertext returns
 * { ok: true, alreadyEncrypted: true } so the client sweep driver can retry
 * safely. A re-call with DIFFERENT ciphertext is rejected with 409 (use
 * /rekey to rotate the WSK; this endpoint is sweep-only).
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ pageId: string }> };

const Body = z.object({ contentEncrypted: z.string().min(1) });

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'editor');

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }

    const db = getDb();
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, page.workspaceId));
    if (ws?.e2eMode !== 'workspace_wide') {
      return NextResponse.json(
        { error: 'workspace is not in workspace_wide mode' },
        { status: 409 },
      );
    }

    const ct = Buffer.from(parsed.data.contentEncrypted, 'base64');
    if (page.encryptedUnderWsk && page.contentEncrypted) {
      if (Buffer.from(page.contentEncrypted).equals(ct)) {
        // Idempotent retry — same ciphertext, no-op.
        return NextResponse.json({ ok: true, alreadyEncrypted: true });
      }
      return NextResponse.json(
        { error: 'page already encrypted; use /rekey to rotate' },
        { status: 409 },
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(pages)
        .set({
          encrypted: true,
          encryptedUnderWsk: true,
          contentEncrypted: ct,
          contentText: '',
          content: { type: 'doc', content: [] },
        })
        .where(eq(pages.id, pageId));
      await recordAudit(tx, {
        workspaceId: page.workspaceId,
        actorUserId: ctx.userId,
        action: 'e2e.page.encrypted',
        targetType: 'page',
        targetId: pageId,
        metadata: { mode: 'workspace_wide' },
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
