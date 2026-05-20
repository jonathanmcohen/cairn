import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

export type MemberRole = schema.MemberRole;

const RANK: Record<MemberRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export function hasMinRole(actual: MemberRole, required: MemberRole): boolean {
  return RANK[actual] >= RANK[required];
}

export type AuthContext = {
  userId: string;
  workspaceId: string;
  role: MemberRole;
};

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const { auth } = await import('./config');
  const session = await auth();
  if (!session?.user?.id) return null;
  const db = getDb();
  const [m] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .limit(1);
  if (!m) return null;
  return { userId: session.user.id, workspaceId: m.workspaceId, role: m.role };
});

export async function requireRole(required: MemberRole): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new HttpError(401, 'Not authenticated');
  }
  if (!hasMinRole(ctx.role, required)) {
    throw new HttpError(403, `Requires role ${required}`);
  }
  return ctx;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
