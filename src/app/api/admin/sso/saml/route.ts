import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { requireRole } from '@/lib/auth/require-role';
import { generateSamlSpKeypair } from '@/lib/sso/saml-keypair';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  idp: z.object({
    entityId: z.string().min(1),
    ssoUrl: z.url(),
    x509Cert: z.string().min(1),
  }),
  attributeMap: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(false),
});

function spEntityIdFor(idpId: string): string {
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${origin.replace(/\/$/, '')}/api/sso/saml/metadata/${idpId}`;
}
function spAcsUrlFor(idpId: string): string {
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${origin.replace(/\/$/, '')}/api/sso/saml/callback/${idpId}`;
}

export async function GET(): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.workspaceId, ctx.workspaceId),
        eq(schema.idpConfigurations.type, 'saml'),
      ),
    )
    .orderBy(desc(schema.idpConfigurations.createdAt));
  // Strip SP private key from list responses — it's a secret that should
  // never round-trip through the admin UI. The cert is fine to expose.
  const items = rows.map((r) => {
    const meta = (r.metadata ?? {}) as {
      sp?: { privateKeyPem?: string; certPem?: string; entityId?: string; acsUrl?: string };
      idp?: unknown;
    };
    const sp = meta.sp ?? {};
    const { privateKeyPem: _privateKeyPem, ...spSafe } = sp;
    return {
      ...r,
      metadata: {
        ...meta,
        sp: { ...spSafe, hasPrivateKey: typeof sp.privateKeyPem === 'string' },
      },
    };
  });
  return NextResponse.json({ items });
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

  // Insert first to get the idpId, then update metadata.sp with a keypair
  // bound to the SP-side URLs (which depend on the idpId). Single tx so a
  // failed keypair gen doesn't leave a half-created config.
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: ctx.workspaceId,
        type: 'saml',
        name: parsed.data.name,
        metadata: { idp: parsed.data.idp, sp: {} },
        attributeMap: parsed.data.attributeMap,
        enabled: parsed.data.enabled,
      })
      .returning({ id: schema.idpConfigurations.id });
    const idpId = row!.id;

    const kp = await generateSamlSpKeypair({ entityId: spEntityIdFor(idpId) });
    await tx
      .update(schema.idpConfigurations)
      .set({
        metadata: {
          idp: parsed.data.idp,
          sp: {
            entityId: spEntityIdFor(idpId),
            acsUrl: spAcsUrlFor(idpId),
            privateKeyPem: kp.privateKeyPem,
            certPem: kp.certPem,
          },
        },
      })
      .where(eq(schema.idpConfigurations.id, idpId));

    return idpId;
  });

  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'sso.idp.created',
    targetType: 'idp_configuration',
    targetId: created,
    metadata: { type: 'saml', name: parsed.data.name, enabled: parsed.data.enabled },
  });

  return NextResponse.json({ id: created }, { status: 201 });
}
