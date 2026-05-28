/**
 * v0.9.0 G8 P39 — Test-fire a SIEM forwarder.
 *
 * Sends a synthetic envelope through the forwarder's configured target and
 * returns success/failure. Used by the admin UI's "Send test" button. NEVER
 * writes a `siem_delivery_log` row — that table is for real audit deliveries
 * only.
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { DEFAULT_SENDERS } from '@/lib/siem/dispatch';
import { formatAuditEvent } from '@/lib/siem/format';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await requireRole('admin');
    const { id } = await ctx.params;
    const db = getDb();

    const [forwarder] = await db
      .select()
      .from(schema.siemForwarders)
      .where(
        and(
          eq(schema.siemForwarders.id, id),
          eq(schema.siemForwarders.workspaceId, auth.workspaceId),
        ),
      )
      .limit(1);
    if (!forwarder) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const send = DEFAULT_SENDERS[forwarder.kind];
    if (!send) {
      return NextResponse.json(
        { ok: false, error: `no sender wired for kind=${forwarder.kind}` },
        { status: 400 },
      );
    }

    const envelope = formatAuditEvent({
      id: '00000000-0000-0000-0000-000000000000',
      workspaceId: auth.workspaceId,
      actorUserId: auth.userId,
      action: 'siem.test_event',
      targetType: 'workspace',
      targetId: auth.workspaceId,
      metadata: { synthetic: true, source: 'admin-ui-test' },
      createdAt: new Date(),
    });

    try {
      await send(
        {
          endpoint: forwarder.endpoint,
          credentialSecret: forwarder.credentialSecret,
          options: forwarder.options,
        },
        envelope,
      );
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
