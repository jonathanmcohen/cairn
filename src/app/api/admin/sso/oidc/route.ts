import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  metadata: z.object({
    issuer: z.url(),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    scopes: z.string().optional(),
  }),
  attributeMap: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(false),
});

export async function GET(): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.workspaceId, ctx.workspaceId),
        eq(schema.idpConfigurations.type, 'oidc'),
      ),
    )
    .orderBy(desc(schema.idpConfigurations.createdAt));
  return NextResponse.json({ items: rows });
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .insert(schema.idpConfigurations)
    .values({
      workspaceId: ctx.workspaceId,
      type: 'oidc',
      name: parsed.data.name,
      metadata: parsed.data.metadata,
      attributeMap: parsed.data.attributeMap,
      enabled: parsed.data.enabled,
    })
    .returning({ id: schema.idpConfigurations.id });

  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'sso.idp.created',
    targetType: 'idp_configuration',
    targetId: row!.id,
    metadata: { type: 'oidc', name: parsed.data.name, enabled: parsed.data.enabled },
  });

  return NextResponse.json({ id: row!.id }, { status: 201 });
}
