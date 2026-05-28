/**
 * v0.9.0 G8 P39 — SIEM forwarder update + delete (admin-only).
 *
 * PATCH partially updates a forwarder. Body fields are independently optional;
 * `credentialSecret: null` clears the credential.
 * DELETE removes the forwarder (its delivery-log rows cascade via FK).
 *
 * Both write a `workspace.settings_changed` audit row whose metadata records
 * the forwarder id + kind + name + (where applicable) which fields changed.
 * Never the credential value.
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  endpoint: z.string().min(1).max(2_000).optional(),
  credentialSecret: z.string().min(1).max(2_000).nullable().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await requireRole('admin');
    const { id } = await ctx.params;
    const parsed = UpdateBody.parse(await req.json());
    const db = getDb();

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.siemForwarders)
        .where(
          and(
            eq(schema.siemForwarders.id, id),
            eq(schema.siemForwarders.workspaceId, auth.workspaceId),
          ),
        )
        .limit(1);
      if (!existing) return null;

      const updates: Partial<typeof schema.siemForwarders.$inferInsert> = { updatedAt: new Date() };
      if (parsed.name !== undefined) updates.name = parsed.name;
      if (parsed.endpoint !== undefined) updates.endpoint = parsed.endpoint;
      if (parsed.credentialSecret !== undefined) updates.credentialSecret = parsed.credentialSecret;
      if (parsed.options !== undefined) updates.options = parsed.options;
      if (parsed.enabled !== undefined) updates.enabled = parsed.enabled;

      const [row] = await tx
        .update(schema.siemForwarders)
        .set(updates)
        .where(eq(schema.siemForwarders.id, id))
        .returning();
      if (!row) throw new Error('siem forwarder update returned no row');

      await recordAudit(tx, {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: auth.workspaceId,
        metadata: {
          siem: {
            op: 'forwarder_updated',
            forwarderId: row.id,
            kind: row.kind,
            name: row.name,
            fields: Object.keys(updates).filter((k) => k !== 'updatedAt'),
          },
        },
      });

      return row;
    });

    if (!updated) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await requireRole('admin');
    const { id } = await ctx.params;
    const db = getDb();

    const removed = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.siemForwarders)
        .where(
          and(
            eq(schema.siemForwarders.id, id),
            eq(schema.siemForwarders.workspaceId, auth.workspaceId),
          ),
        )
        .limit(1);
      if (!existing) return null;

      await tx.delete(schema.siemForwarders).where(eq(schema.siemForwarders.id, id));

      await recordAudit(tx, {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: auth.workspaceId,
        metadata: {
          siem: {
            op: 'forwarder_deleted',
            forwarderId: existing.id,
            kind: existing.kind,
            name: existing.name,
          },
        },
      });

      return existing;
    });

    if (!removed) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
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
