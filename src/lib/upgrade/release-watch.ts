/**
 * v0.9.0 G8 P42 — release-watch tick.
 *
 * `runReleaseWatchTick(deps)` fetches the configured release feed, compares
 * the latest stable tag against the running version, and inserts one
 * `notifications` row per (admin/owner user, workspace) that has not yet
 * been notified for that target version.
 *
 * Idempotent per (user, workspace, version): re-running with the same feed
 * inserts zero rows. A newer feed inserts only the missing rows. The
 * fan-out is a single SQL INSERT … SELECT … WHERE NOT EXISTS so the read +
 * write happen in one statement (no races against a concurrent tick).
 *
 * Pure side-effect: never auto-applies. The notification surfaces the gap
 * to admins; the `/settings/admin/upgrade` page exposes the button that
 * actually triggers `applyUpgrade`.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { compareVersions } from './feed';

type Db = PostgresJsDatabase<typeof schema>;

export type ReleaseFeedFetch = () => Promise<
  { ok: true; latestTag: string; releaseNotesUrl: string } | { ok: false; reason: string }
>;

export type ReleaseWatchTickInput = {
  /** Bundled `package.json#version` at runtime. */
  currentVersion: string;
  /** Inject the feed adapter — call sites pass `() => fetchReleaseFeed({ url })`. */
  fetchFeed: ReleaseFeedFetch;
  db: Db;
};

export type ReleaseWatchTickResult = {
  notificationsCreated: number;
  latestTag?: string;
  feedError?: string;
};

export async function runReleaseWatchTick(
  input: ReleaseWatchTickInput,
): Promise<ReleaseWatchTickResult> {
  const feed = await input.fetchFeed();
  if (!feed.ok) return { notificationsCreated: 0, feedError: feed.reason };

  const cmp = compareVersions({ current: input.currentVersion, latest: feed.latestTag });
  if (!cmp.isNewer) return { notificationsCreated: 0, latestTag: feed.latestTag };

  // Fan out one row per (admin/owner member, workspace) that hasn't been
  // notified for this exact target version yet. The NOT EXISTS clause keys
  // off `notifications.payload->>'version'`, so the same user receives a
  // *new* row only when the feed advances to a newer tag.
  const payload = {
    version: feed.latestTag,
    releaseNotesUrl: feed.releaseNotesUrl,
  };
  const rows = (await input.db.execute(sql`
    INSERT INTO notifications (user_id, workspace_id, type, payload, created_at)
    SELECT wm.user_id,
           wm.workspace_id,
           'upgrade_available',
           ${JSON.stringify(payload)}::jsonb,
           now()
    FROM workspace_members wm
    WHERE wm.role IN ('owner', 'admin')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = wm.user_id
          AND n.workspace_id = wm.workspace_id
          AND n.type = 'upgrade_available'
          AND n.payload->>'version' = ${feed.latestTag}
      )
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  return { notificationsCreated: rows.length, latestTag: feed.latestTag };
}
