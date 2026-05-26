import { eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { pageEncryptionKeys, pages, userKeypairs, workspaceMembers } from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError } from '@/lib/auth/require-role';
import { logger } from '@/lib/observability/logger';
import { requirePageAccess } from '@/lib/pages/access';

/**
 * v0.9.0 G1 P6 — POST /api/pages/[pageId]/encrypt.
 *
 * The caller (editor+) submits ciphertext + a wrapped-DEK row per current
 * workspace member. Server-side guarantees:
 *  - caller has page write access (via requirePageAccess(editor)),
 *  - the wrapped-DEK set covers every current workspace member exactly once,
 *  - every covered member has a registered X25519 keypair (`user_keypairs`),
 *  - on success, one transaction:
 *      * pages.encrypted=true, contentEncrypted=ct, contentText='',
 *        content={type:'doc',content:[]} (sentinel for legacy readers),
 *      * delete + reinsert page_encryption_keys rows (idempotent / DEK rotation),
 *      * append the e2e.page.encrypted audit row.
 *
 * The server never sees the DEK or page plaintext.
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ pageId: string }> };

const Body = z.object({
  contentEncrypted: z.string().min(1),
  wrappedDeks: z
    .array(
      z.object({
        memberUserId: z.uuid(),
        wrappedDek: z.string().min(1),
      }),
    )
    .min(1),
});

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'editor');

    const rawBody = await req.json().catch(() => null);
    const parsed = Body.safeParse(rawBody);
    if (!parsed.success) {
      // Don't leak Zod internals — generic 400.
      return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
    }
    const { contentEncrypted, wrappedDeks } = parsed.data;

    const db = getDb();

    // The wrapped-DEK set MUST cover every current workspace member.
    // Wrap-to-all (not just per-page ACL) avoids a removed-but-cached-ACL leak:
    // if an admin later widens access, the new viewer still cannot decrypt
    // unless someone re-encrypts (DEK rotation via re-POST).
    const members = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, page.workspaceId));
    const memberIds = new Set(members.map((m) => m.userId));
    const payloadIds = new Set(wrappedDeks.map((w) => w.memberUserId));

    if (memberIds.size !== payloadIds.size) {
      return NextResponse.json(
        { error: 'wrapped DEKs must cover every workspace member exactly once' },
        { status: 400 },
      );
    }
    for (const id of memberIds) {
      if (!payloadIds.has(id)) {
        return NextResponse.json(
          { error: 'wrapped DEKs must cover every workspace member exactly once' },
          { status: 400 },
        );
      }
    }
    // Also reject duplicates in payload (Set collapses dupes, so size-equality
    // already catches it; the explicit check above is redundant insurance).
    if (wrappedDeks.length !== payloadIds.size) {
      return NextResponse.json(
        { error: 'wrapped DEKs must cover every workspace member exactly once' },
        { status: 400 },
      );
    }

    // Every covered member must have a registered keypair.
    const keypairs = await db
      .select({ userId: userKeypairs.userId })
      .from(userKeypairs)
      .where(inArray(userKeypairs.userId, [...memberIds]));
    if (keypairs.length !== memberIds.size) {
      return NextResponse.json(
        { error: 'one or more workspace members have no registered E2E keypair' },
        { status: 409 },
      );
    }

    let ctBuf: Buffer;
    try {
      ctBuf = Buffer.from(contentEncrypted, 'base64');
      if (ctBuf.byteLength === 0) throw new Error('empty');
    } catch {
      return NextResponse.json({ error: 'invalid contentEncrypted base64' }, { status: 400 });
    }

    let wrappedBufs: Array<{ memberUserId: string; wrappedDek: Buffer }>;
    try {
      wrappedBufs = wrappedDeks.map((w) => {
        const buf = Buffer.from(w.wrappedDek, 'base64');
        if (buf.byteLength === 0) throw new Error('empty');
        return { memberUserId: w.memberUserId, wrappedDek: buf };
      });
    } catch {
      return NextResponse.json({ error: 'invalid wrappedDek base64' }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(pages)
        .set({
          encrypted: true,
          contentEncrypted: ctBuf,
          contentText: '',
          content: { type: 'doc', content: [] },
          updatedAt: new Date(),
        })
        .where(eq(pages.id, pageId));
      // Idempotent: wipe + reinsert for this page (DEK rotation).
      await tx.delete(pageEncryptionKeys).where(eq(pageEncryptionKeys.pageId, pageId));
      await tx.insert(pageEncryptionKeys).values(
        wrappedBufs.map((w) => ({
          pageId,
          memberUserId: w.memberUserId,
          wrappedDek: w.wrappedDek,
        })),
      );
      await recordAudit(tx, {
        workspaceId: page.workspaceId,
        actorUserId: ctx.userId,
        action: 'e2e.page.encrypted',
        targetType: 'page',
        targetId: pageId,
        metadata: { memberCount: wrappedBufs.length },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Don't leak internals (P5/P6 retrospective: external/parser errors get
    // generic 400; log details server-side for debugging).
    logger.error(
      { err: err instanceof Error ? { message: err.message, name: err.name } : err },
      '[e2e.encrypt] unhandled error',
    );
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
}
