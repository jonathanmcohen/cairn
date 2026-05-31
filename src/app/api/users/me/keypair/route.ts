import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { userKeypairs } from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * v0.9.7 G21 (#168) — self-service E2E keypair enrollment.
 *
 * GET  /api/users/me/keypair  → { enrolled: boolean, publicKey?: base64 }
 * PUT  /api/users/me/keypair  → persist the caller's sealed keypair.
 *
 * The server stores ONLY sealed material: the X25519 public key plus the
 * AES-256-GCM-sealed private key (scrypt(passphrase)-derived KEK) and its
 * KDF parameters. It never receives the passphrase or the unsealed private
 * key. A user may write ONLY their own row (ctx.userId); there is no
 * admin/cross-user enrollment (which would enable a key-substitution attack
 * where an admin swaps in a key they control and silently reads future wraps).
 *
 * First-write-wins: re-PUT with a DIFFERENT public key is rejected (409) to
 * avoid silently stranding already-wrapped DEKs/WSKs (only the old private key
 * can decrypt them) and to make key substitution observable. Re-PUT of the
 * SAME public key is idempotent (lets a re-enrolling device confirm its blob
 * matches the server). True key-rotation-with-rewrap is out of scope for
 * v0.9.7; that flows through the workspace rekey path instead.
 */
export const runtime = 'nodejs';

const PUBLIC_KEY_BYTES = 32;
const SEALED_BYTES = 60; // iv(12) || ct(32) || tag(16)
const SALT_BYTES = 16;

const Body = z.object({
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  kdfSalt: z.string().min(1),
  kdfIters: z.number().int().positive(),
});

function decodeExact(b64: string, len: number): Buffer | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.byteLength === len ? buf : null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const db = getDb();
    const [row] = await db
      .select({ publicKey: userKeypairs.publicKey })
      .from(userKeypairs)
      .where(eq(userKeypairs.userId, ctx.userId));
    if (!row) return NextResponse.json({ enrolled: false });
    return NextResponse.json({
      enrolled: true,
      publicKey: Buffer.from(row.publicKey).toString('base64'),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }
    const pub = decodeExact(parsed.data.publicKey, PUBLIC_KEY_BYTES);
    const sealed = decodeExact(parsed.data.encryptedPrivateKey, SEALED_BYTES);
    const salt = decodeExact(parsed.data.kdfSalt, SALT_BYTES);
    if (!pub || !sealed || !salt) {
      return NextResponse.json({ error: 'invalid key material' }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select({ publicKey: userKeypairs.publicKey })
      .from(userKeypairs)
      .where(eq(userKeypairs.userId, ctx.userId));
    if (existing) {
      // Idempotent re-PUT of the same public key is fine; a DIFFERENT key
      // would strand prior wraps and looks like a substitution attack.
      if (!Buffer.from(existing.publicKey).equals(pub)) {
        return NextResponse.json(
          { error: 'a keypair is already enrolled for this user' },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    await db.transaction(async (tx) => {
      await tx.insert(userKeypairs).values({
        userId: ctx.userId,
        publicKey: pub,
        encryptedPrivateKey: sealed,
        kdfSalt: salt,
        kdfIters: parsed.data.kdfIters,
      });
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'e2e.keypair.created',
        targetType: 'user',
        targetId: ctx.userId,
        metadata: { kdfIters: parsed.data.kdfIters },
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
