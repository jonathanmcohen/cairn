/**
 * v0.9.0 G2 P14 — Lock banner.
 *
 * Server component. Reads `isLocked(pageId)` and renders an amber strip above
 * the editor when the page is locked, with the locker's name + a relative
 * "auto-unlocks in …" (or "indefinite") + an "Unlock"/"Override unlock"
 * button visible only to the locker (self) or an admin (override).
 *
 * No-ops when the page is unlocked or when the resolved `lockedBy` user row
 * has been deleted (best-effort name lookup).
 */
import { eq } from 'drizzle-orm';
import { Lock } from 'lucide-react';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { isLocked } from '@/lib/pages/lock';
import { UnlockButton } from './lock-toggle';

type LockBannerProps = {
  pageId: string;
  viewerUserId: string;
  viewerIsAdmin: boolean;
};

function formatRelative(target: Date): string {
  const deltaMs = target.getTime() - Date.now();
  if (deltaMs <= 0) return 'momentarily';
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export async function LockBanner({
  pageId,
  viewerUserId,
  viewerIsAdmin,
}: LockBannerProps): Promise<React.ReactElement | null> {
  const state = await isLocked(getDb(), pageId);
  if (!state.locked) return null;

  let lockerName = 'an editor';
  if (state.lockedBy) {
    const [row] = await getDb()
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, state.lockedBy))
      .limit(1);
    if (row?.name) lockerName = row.name;
  }

  const isSelfLocker = state.lockedBy === viewerUserId;
  const canUnlock = isSelfLocker || viewerIsAdmin;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950"
    >
      <Lock className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden />
      <span className="min-w-0 flex-1">
        Locked by <strong>{lockerName}</strong>
        {state.lockedUntil ? (
          <> · auto-unlocks in {formatRelative(state.lockedUntil)}</>
        ) : (
          <> · indefinite</>
        )}
      </span>
      {canUnlock && (
        <UnlockButton pageId={pageId} isAdminOverride={!isSelfLocker && viewerIsAdmin} />
      )}
    </div>
  );
}
