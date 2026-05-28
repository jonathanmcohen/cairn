import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/webauthn/credentials
 *
 * Lists the calling user's registered passkeys. Excludes `publicKey` and
 * `signCount` — those are server-only authenticator material that the
 * settings UI doesn't need.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select({
      id: schema.userWebauthnCredentials.id,
      nickname: schema.userWebauthnCredentials.nickname,
      createdAt: schema.userWebauthnCredentials.createdAt,
      lastUsedAt: schema.userWebauthnCredentials.lastUsedAt,
    })
    .from(schema.userWebauthnCredentials)
    .where(eq(schema.userWebauthnCredentials.userId, session.user.id))
    .orderBy(desc(schema.userWebauthnCredentials.createdAt));
  return NextResponse.json({ items: rows });
}
