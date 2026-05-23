import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate a fresh `cairn_whsec_<random>` secret. 32 bytes of entropy
 * base64url-encoded → 43 chars after the prefix. URL-safe.
 */
function mintWebhookSecret(): string {
  const raw = randomBytes(32).toString('base64url');
  return `cairn_whsec_${raw}`;
}

/**
 * POST /api/webhooks/:id/rotate-secret
 *
 * Mint a new HMAC signing secret, store it (replacing the old one), and return
 * the plaintext ONCE in the response body. Admin-gated. The old secret is
 * invalidated atomically — subsequent deliveries sign with the new value.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const newSecret = mintWebhookSecret();
    const db = getDb();

    const updated = await db
      .update(schema.webhooks)
      .set({ secret: newSecret })
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.workspaceId, ctx.workspaceId)))
      .returning({ id: schema.webhooks.id });

    if (updated.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Audit-log via the v0.6 P18 helper. Wrapped so a transient audit failure
    // doesn't break the rotation — the secret rotation itself is the
    // load-bearing contract.
    try {
      await recordAudit(db, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'webhook.secret_rotated',
        targetType: 'webhook',
        targetId: id,
        // Metadata is operator-visible — only ids/flags. Never the secret.
        metadata: { webhookId: id },
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err, webhookId: id },
        '[webhooks] audit recordAudit failed for secret rotation',
      );
    }

    return NextResponse.json({ secret: newSecret }, { status: 200 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
