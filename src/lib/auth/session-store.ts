import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type ActiveSession = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
};

/**
 * Mint a new session: generate a `sid` (uuid), insert the row, return the sid
 * for the Auth.js `jwt` callback to embed in the token. UA/IP are best-effort
 * (null when the request didn't carry them).
 */
export async function createSession(
  db: Db,
  args: { userId: string; userAgent?: string | null; ip?: string | null },
): Promise<string> {
  const sid = randomUUID();
  await db.insert(schema.authSessions).values({
    id: sid,
    userId: args.userId,
    userAgent: args.userAgent ?? null,
    ip: args.ip ?? null,
  });
  return sid;
}

/**
 * True iff a non-revoked session row exists for THIS user with THIS sid. The
 * user-id match prevents a leaked sid from being honored against another
 * account. Called on every gated request, so it stays a single indexed lookup.
 */
export async function isSessionActive(db: Db, userId: string, sid: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.authSessions.id })
    .from(schema.authSessions)
    .where(
      and(
        eq(schema.authSessions.id, sid),
        eq(schema.authSessions.userId, userId),
        isNull(schema.authSessions.revokedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Bump last_seen_at for an active session (best-effort liveness clock). */
export async function touchSession(db: Db, sid: string): Promise<void> {
  await db
    .update(schema.authSessions)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(schema.authSessions.id, sid), isNull(schema.authSessions.revokedAt)));
}

/** All non-revoked sessions for a user, newest-seen first. */
export async function listActiveSessions(db: Db, userId: string): Promise<ActiveSession[]> {
  return db
    .select({
      id: schema.authSessions.id,
      userAgent: schema.authSessions.userAgent,
      ip: schema.authSessions.ip,
      createdAt: schema.authSessions.createdAt,
      lastSeenAt: schema.authSessions.lastSeenAt,
    })
    .from(schema.authSessions)
    .where(and(eq(schema.authSessions.userId, userId), isNull(schema.authSessions.revokedAt)))
    .orderBy(desc(schema.authSessions.lastSeenAt));
}

/**
 * Revoke ONE session by id, scoped to the owning user. The user-id match means
 * a caller can only revoke their own sessions — passing someone else's sid
 * (or an unknown/already-revoked one) revokes nothing. Idempotent. Returns true
 * iff a row was newly revoked.
 *
 * v0.10.3 Q-2 — per-session "Revoke" in Settings → Security.
 */
export async function revokeSingleSession(db: Db, userId: string, sid: string): Promise<boolean> {
  const rows = await db
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.authSessions.id, sid),
        eq(schema.authSessions.userId, userId),
        isNull(schema.authSessions.revokedAt),
      ),
    )
    .returning({ id: schema.authSessions.id });
  return rows.length > 0;
}

/**
 * Revoke sessions for a user. With `exceptSid` the current device stays signed
 * in ("sign out everywhere else"); without it every session including the
 * caller is revoked. Returns the number of rows newly revoked.
 */
export async function revokeAllSessions(
  db: Db,
  userId: string,
  opts: { exceptSid?: string },
): Promise<number> {
  const where = opts.exceptSid
    ? and(
        eq(schema.authSessions.userId, userId),
        isNull(schema.authSessions.revokedAt),
        ne(schema.authSessions.id, opts.exceptSid),
      )
    : and(eq(schema.authSessions.userId, userId), isNull(schema.authSessions.revokedAt));
  const rows = await db
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(where)
    .returning({ id: schema.authSessions.id });
  return rows.length;
}
