import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  metadata: z
    .object({
      issuer: z.url(),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1).optional(),
      scopes: z.string().optional(),
    })
    .optional(),
  attributeMap: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

async function loadOwnedIdp(idpId: string, workspaceId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.id, idpId),
        eq(schema.idpConfigurations.workspaceId, workspaceId),
        eq(schema.idpConfigurations.type, 'oidc'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const session = await requireRole('admin').catch(() => null);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { idpId } = await ctx.params;
  const existing = await loadOwnedIdp(idpId, session.workspaceId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.metadata !== undefined) {
    // Merge over existing metadata so blank clientSecret on edit keeps the
    // prior secret (admin form leaves password field blank by default).
    const prior = (existing.metadata as Record<string, unknown> | null) ?? {};
    const next: Record<string, unknown> = { ...prior, ...parsed.data.metadata };
    if (
      parsed.data.metadata.clientSecret === undefined ||
      parsed.data.metadata.clientSecret === ''
    ) {
      next.clientSecret = prior.clientSecret;
    }
    updates.metadata = next;
  }
  if (parsed.data.attributeMap !== undefined) updates.attributeMap = parsed.data.attributeMap;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;

  const db = getDb();
  await db
    .update(schema.idpConfigurations)
    .set(updates as never)
    .where(eq(schema.idpConfigurations.id, idpId));

  await recordAudit(db, {
    workspaceId: session.workspaceId,
    actorUserId: session.userId,
    action: 'sso.idp.updated',
    targetType: 'idp_configuration',
    targetId: idpId,
    metadata: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const session = await requireRole('admin').catch(() => null);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { idpId } = await ctx.params;
  const existing = await loadOwnedIdp(idpId, session.workspaceId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const db = getDb();
  await db.delete(schema.idpConfigurations).where(eq(schema.idpConfigurations.id, idpId));
  await recordAudit(db, {
    workspaceId: session.workspaceId,
    actorUserId: session.userId,
    action: 'sso.idp.deleted',
    targetType: 'idp_configuration',
    targetId: idpId,
    metadata: { name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
