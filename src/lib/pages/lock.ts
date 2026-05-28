/**
 * v0.9.0 G2 P14 — Page lock.
 *
 * A page is "locked" iff `pages.locked_at IS NOT NULL`. While locked, every
 * mutation pathway (content, title, icon, cover, comments, soft-delete, move)
 * MUST call `requireUnlocked` first and refuse with `PageLockedError` unless
 * the caller is the locker or is performing an admin override.
 *
 * `locked_until` may be NULL (manual-unlock only) or a future timestamp; the
 * auto-unlock cron (`pages:auto-unlock`) sweeps rows whose `locked_until` has
 * passed every 5 minutes, clearing all three cols and emitting one
 * `page.auto_unlocked` audit row per affected page.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError } from '@/lib/auth/http-error';

export type LockState =
  | { locked: false; lockedBy: null; lockedAt: null; lockedUntil: null }
  | { locked: true; lockedBy: string | null; lockedAt: Date; lockedUntil: Date | null };

/**
 * The `locked_by` user can be deleted (ON DELETE SET NULL) — at that point the
 * lock is still "real" (the page is still frozen) but only an admin can clear
 * it. Callers needing the actor for an audit row should fall back to the
 * unlocking actor when `lockedBy` is null.
 */
export async function isLocked(
  db: PostgresJsDatabase<typeof schema>,
  pageId: string,
): Promise<LockState> {
  const [row] = await db
    .select({
      lockedAt: schema.pages.lockedAt,
      lockedBy: schema.pages.lockedBy,
      lockedUntil: schema.pages.lockedUntil,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  if (!row || !row.lockedAt) {
    return { locked: false, lockedBy: null, lockedAt: null, lockedUntil: null };
  }
  return {
    locked: true,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt,
    lockedUntil: row.lockedUntil,
  };
}

export class PageLockedError extends HttpError {
  readonly code = 'PageLocked';
  constructor(public state: LockState) {
    super(403, 'Page is locked');
    this.name = 'PageLockedError';
  }
}

/**
 * Guard called at the top of every page-write helper. Throws
 * `PageLockedError` unless the caller is the locker OR is performing an
 * explicit admin override. Re-reads `pages` each call so concurrent unlocks
 * don't surface stale errors.
 */
export async function requireUnlocked(
  db: PostgresJsDatabase<typeof schema>,
  input: { pageId: string; byUserId: string; adminOverride: boolean },
): Promise<void> {
  const state = await isLocked(db, input.pageId);
  if (!state.locked) return;
  // v0.9.0 G2 P14 review — an expired `locked_until` no longer blocks writes;
  // the auto-unlock cron is solely responsible for clearing the columns, but
  // the gate respects the cutoff so writes don't wait on the sweep. A NULL
  // `locked_until` is an indefinite (manual-only) lock and still blocks.
  if (state.lockedUntil !== null && state.lockedUntil.getTime() <= Date.now()) return;
  if (input.adminOverride) return;
  if (state.lockedBy === input.byUserId) return;
  throw new PageLockedError(state);
}

export type LockPageInput = {
  pageId: string;
  byUserId: string;
  workspaceId: string;
  lockedUntil?: Date | null;
};

/**
 * Acquire (or refresh) a lock. Transactional: the UPDATE + audit row commit
 * together so the log can never drift from state.
 */
export async function lockPage(
  db: PostgresJsDatabase<typeof schema>,
  input: LockPageInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    const lockedUntil = input.lockedUntil ?? null;
    await tx
      .update(schema.pages)
      .set({
        lockedAt: now,
        lockedBy: input.byUserId,
        lockedUntil,
      })
      .where(eq(schema.pages.id, input.pageId));
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.byUserId,
      action: 'page.locked',
      targetType: 'page',
      targetId: input.pageId,
      metadata: {
        pageId: input.pageId,
        lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
      },
    });
  });
}

export type UnlockPageInput = {
  pageId: string;
  byUserId: string;
  workspaceId: string;
  adminOverride: boolean;
};

/**
 * Release a lock. A no-op when the page isn't locked. Throws
 * `PageLockedError` when the caller is neither the locker nor an admin
 * override. An admin force-unlocking someone else's lock records
 * `page.unlock_overridden_by_admin`; a self-unlock (even by an admin who
 * happens to be the locker) stays a plain `page.unlocked`.
 */
export async function unlockPage(
  db: PostgresJsDatabase<typeof schema>,
  input: UnlockPageInput,
): Promise<void> {
  const state = await isLocked(db, input.pageId);
  if (!state.locked) return;
  const isSelfUnlock = state.lockedBy === input.byUserId;
  if (!isSelfUnlock && !input.adminOverride) {
    throw new PageLockedError(state);
  }
  await db.transaction(async (tx) => {
    await tx
      .update(schema.pages)
      .set({ lockedAt: null, lockedBy: null, lockedUntil: null })
      .where(eq(schema.pages.id, input.pageId));
    const action =
      input.adminOverride && !isSelfUnlock ? 'page.unlock_overridden_by_admin' : 'page.unlocked';
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.byUserId,
      action,
      targetType: 'page',
      targetId: input.pageId,
      metadata: {
        pageId: input.pageId,
        originalLockerId: state.lockedBy,
        lockedAt: state.lockedAt.toISOString(),
      },
    });
  });
}
