import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { parseLoginResponse } from '@/lib/sso/saml';
import { mintSessionCookieForUser } from '@/lib/sso/session-mint';

export const dynamic = 'force-dynamic';

export async function readSamlResponse(
  req: Request,
): Promise<{ SAMLResponse: string; RelayState?: string } | null> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    const sr = params.get('SAMLResponse');
    if (!sr) return null;
    const rs = params.get('RelayState') ?? undefined;
    return { SAMLResponse: sr, RelayState: rs };
  }
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const sr = form.get('SAMLResponse');
    if (typeof sr !== 'string' || sr.length === 0) return null;
    const rs = form.get('RelayState');
    return { SAMLResponse: sr, RelayState: typeof rs === 'string' ? rs : undefined };
  }
  return null;
}

export async function handleSamlResponse(
  idpId: string,
  body: { SAMLResponse: string; RelayState?: string },
): Promise<Response> {
  const db = getDb();
  const [idp] = await db
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.id, idpId),
        eq(schema.idpConfigurations.type, 'saml'),
        eq(schema.idpConfigurations.enabled, true),
      ),
    )
    .limit(1);
  if (!idp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let parsed: { nameId: string; attributes: Record<string, string> };
  try {
    parsed = await parseLoginResponse(idp, body);
  } catch (err) {
    // Log the underlying samlify error server-side for ops debuggability,
    // but return a generic 400 to the IdP/browser.
    console.error('SAML parseLoginResponse failed', err);
    return NextResponse.json({ error: 'Invalid SAMLResponse' }, { status: 400 });
  }

  const emailKey = (idp.attributeMap as Record<string, string> | null)?.email ?? 'email';
  const nameKey = (idp.attributeMap as Record<string, string> | null)?.name ?? 'name';
  const email = parsed.attributes[emailKey] ?? parsed.nameId;
  const name = parsed.attributes[nameKey] ?? email;
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'IdP did not return a valid email' }, { status: 400 });
  }

  // (1) Existing link?
  const [existingLink] = await db
    .select()
    .from(schema.externalIdentities)
    .where(
      and(
        eq(schema.externalIdentities.idpConfigId, idpId),
        eq(schema.externalIdentities.externalId, parsed.nameId),
      ),
    )
    .limit(1);

  let userId: string;
  if (existingLink) {
    userId = existingLink.userId;
    await db
      .update(schema.externalIdentities)
      .set({ lastSeenAt: new Date(), rawAttrs: parsed.attributes })
      .where(eq(schema.externalIdentities.id, existingLink.id));
  } else {
    const [existingUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existingUser) {
      userId = existingUser.id;
      const [membership] = await db
        .select()
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, idp.workspaceId),
            eq(schema.workspaceMembers.userId, userId),
          ),
        )
        .limit(1);
      if (!membership) {
        await db
          .insert(schema.workspaceMembers)
          .values({ workspaceId: idp.workspaceId, userId, role: 'editor' });
      }
    } else {
      const [provisionedUser] = await db
        .insert(schema.users)
        .values({ email, name, passwordHash: 'sso:no-password' })
        .returning({ id: schema.users.id });
      userId = provisionedUser!.id;
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId: idp.workspaceId, userId, role: 'editor' });
    }
    // Idempotent upsert keyed by (idpConfigId, externalId) — matches the unique
    // index `external_identities_idp_external_uq`. Mirrors the OIDC route's
    // P2 security-review fix.
    await db
      .insert(schema.externalIdentities)
      .values({
        userId,
        idpConfigId: idpId,
        externalId: parsed.nameId,
        rawAttrs: parsed.attributes,
      })
      .onConflictDoUpdate({
        target: [schema.externalIdentities.idpConfigId, schema.externalIdentities.externalId],
        set: {
          userId,
          lastSeenAt: new Date(),
          rawAttrs: parsed.attributes,
        },
      });
  }

  await mintSessionCookieForUser({ userId, email, name });

  // Anti-open-redirect: only honor RelayState when it's a same-origin path.
  const returnTo = body.RelayState && body.RelayState.startsWith('/') ? body.RelayState : '/';
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return NextResponse.redirect(new URL(returnTo, origin), 302);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const { idpId } = await ctx.params;
  const body = await readSamlResponse(req);
  if (!body) return NextResponse.json({ error: 'Missing SAMLResponse' }, { status: 400 });
  return handleSamlResponse(idpId, body);
}
