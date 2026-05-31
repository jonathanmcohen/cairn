import { asc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError } from './http-error';
import { isSessionActive } from './session-store';

// Re-export so existing consumers that already import `HttpError` from
// `@/lib/auth/require-role` keep working without a churn-only rename.
export { HttpError };

export type MemberRole = schema.MemberRole;

const RANK: Record<MemberRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export const ACTIVE_WORKSPACE_COOKIE = 'cairn_ws';

export function hasMinRole(actual: MemberRole, required: MemberRole): boolean {
  return RANK[actual] >= RANK[required];
}

export type AuthContext = {
  userId: string;
  workspaceId: string | null;
  role: MemberRole | null;
};

/** A context guaranteed to have an active workspace. */
export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: MemberRole;
};

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const { auth } = await import('./config');
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  // v0.9.6 G8b (#70) — sessions are revocable despite the stateless jwt
  // strategy: if this token carries a `sid` whose auth_sessions row is missing
  // or revoked, treat the request as signed out. Tokens with no sid (OAuth /
  // pre-0.9.6 logins) pass through unchanged.
  const sid = (session as { sid?: string }).sid;
  if (sid && !(await isSessionActive(getDb(), userId, sid))) {
    return null;
  }

  const db = getDb();
  const memberships = await db
    .select({
      workspaceId: schema.workspaceMembers.workspaceId,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaceMembers.joinedAt));

  if (memberships.length === 0) {
    return { userId, workspaceId: null, role: null };
  }

  const store = await cookies();
  const cookieWs = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const active = memberships.find((m) => m.workspaceId === cookieWs) ?? memberships[0];
  if (!active) return { userId, workspaceId: null, role: null };

  // Best-effort: pin the resolved workspace into the cookie when it wasn't a
  // valid match. cookies() is read-only in some render contexts, so swallow.
  if (active.workspaceId !== cookieWs) {
    try {
      store.set(ACTIVE_WORKSPACE_COOKIE, active.workspaceId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      });
    } catch {
      // ignore — read-only cookie store
    }
  }

  return { userId, workspaceId: active.workspaceId, role: active.role };
});

/** Narrow an AuthContext to one with an active workspace, or throw 401. */
export function requireWorkspace(ctx: AuthContext | null): WorkspaceContext {
  if (!ctx) throw new HttpError(401, 'Not authenticated');
  if (!ctx.workspaceId || !ctx.role) throw new HttpError(401, 'No active workspace');
  return { userId: ctx.userId, workspaceId: ctx.workspaceId, role: ctx.role };
}

export async function requireRole(required: MemberRole): Promise<WorkspaceContext> {
  const ctx = requireWorkspace(await getAuthContext());
  if (!hasMinRole(ctx.role, required)) {
    throw new HttpError(403, `Requires role ${required}`);
  }
  return ctx;
}

// HttpError was previously defined here; moved to ./http-error so lib helpers
// (e.g. src/lib/pages/lock.ts) can import it without dragging the `next/headers`
// import above into Playwright's source-loaded test graph. The top-of-file
// `import { HttpError } from './http-error'` + value re-export keeps existing
// consumers working.
