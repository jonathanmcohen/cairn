import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { exchangeCode } from '@/lib/sso/oidc';
import { verifyOidcState } from '@/lib/sso/oidc-state';
import { mintSessionCookieForUser } from '@/lib/sso/session-mint';

export const dynamic = 'force-dynamic';

function redirectUriFor(idpId: string): string {
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${origin.replace(/\/$/, '')}/api/sso/oidc/callback/${idpId}`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const { idpId } = await ctx.params;
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !stateParam) {
    return NextResponse.json({ error: 'missing code or state' }, { status: 400 });
  }

  const jar = await cookies();
  const cookieState = jar.get(`cairn_oidc_state_${idpId}`)?.value;
  if (!cookieState || cookieState !== stateParam) {
    return NextResponse.json({ error: 'state mismatch' }, { status: 400 });
  }
  let statePayload: { idpId: string; nonce: string; returnTo: string };
  try {
    statePayload = await verifyOidcState(stateParam, idpId);
  } catch {
    return NextResponse.json({ error: 'invalid state' }, { status: 400 });
  }

  const db = getDb();
  const [idp] = await db
    .select()
    .from(schema.idpConfigurations)
    .where(eq(schema.idpConfigurations.id, idpId))
    .limit(1);
  if (!idp || idp.type !== 'oidc' || !idp.enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const exchange = await exchangeCode(idp, {
    code,
    redirectUri: redirectUriFor(idpId),
  });

  const attrMap = (idp.attributeMap as Record<string, string> | null) ?? {};
  const claimEmailKey = attrMap.email ?? 'email';
  const claimNameKey = attrMap.name ?? 'name';
  const claims = exchange.claims;
  const emailRaw = claims[claimEmailKey];
  const nameRaw = claims[claimNameKey];
  const email = typeof emailRaw === 'string' ? emailRaw : null;
  const name = typeof nameRaw === 'string' ? nameRaw : (email ?? exchange.sub);
  if (!email) {
    return NextResponse.json({ error: 'IdP did not return email' }, { status: 400 });
  }

  // (1) Existing link?
  const [existingLink] = await db
    .select()
    .from(schema.externalIdentities)
    .where(
      and(
        eq(schema.externalIdentities.idpConfigId, idpId),
        eq(schema.externalIdentities.externalId, exchange.sub),
      ),
    )
    .limit(1);

  let userId: string;
  if (existingLink) {
    userId = existingLink.userId;
    await db
      .update(schema.externalIdentities)
      .set({ lastSeenAt: new Date(), rawAttrs: claims as Record<string, unknown> })
      .where(eq(schema.externalIdentities.id, existingLink.id));
  } else {
    // (2) Existing user by email in this workspace?
    const [existingUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existingUser) {
      userId = existingUser.id;
      // Ensure the user is a member of the IdP's workspace; insert if not.
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
      // (3) Provision: new user + workspace_member (role: 'editor').
      const [provisionedUser] = await db
        .insert(schema.users)
        .values({ email, name, passwordHash: 'sso:no-password' })
        .returning({ id: schema.users.id });
      userId = provisionedUser!.id;
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId: idp.workspaceId, userId, role: 'editor' });
    }
    await db.insert(schema.externalIdentities).values({
      userId,
      idpConfigId: idpId,
      externalId: exchange.sub,
      rawAttrs: claims as Record<string, unknown>,
    });
  }

  await mintSessionCookieForUser({ userId, email, name });
  jar.delete(`cairn_oidc_state_${idpId}`);

  return NextResponse.redirect(
    new URL(statePayload.returnTo.startsWith('/') ? statePayload.returnTo : '/', req.url),
    302,
  );
}
