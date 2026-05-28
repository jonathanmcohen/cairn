/**
 * CLI shim for the `release-watch:tick` scheduler command (v0.9.0 G8 P42).
 *
 * Thin wrapper around `runReleaseWatchTick` — mirrors the trash:purge /
 * pages:auto-unlock / flashcards:notify-due / siem:retry-sweep pattern so
 * the cron dispatcher can `await import(...)` it without pulling in
 * `@/db/client` or `@/lib/env` at module-load time.
 */
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { fetchReleaseFeed } from './feed';
import { type ReleaseWatchTickResult, runReleaseWatchTick } from './release-watch';
import { readPackageVersion } from './version';

export async function runReleaseWatchTickCli(): Promise<ReleaseWatchTickResult> {
  return runReleaseWatchTick({
    db: getDb(),
    currentVersion: await readPackageVersion(),
    fetchFeed: () => fetchReleaseFeed({ url: env().CAIRN_RELEASE_FEED_URL }),
  });
}
