import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { compareJournalToDb, loadBundledJournal } from './migrations.js';

export type HealthcheckResult = {
  ok: boolean;
  drift: boolean;
  reason?: string;
  appliedCount?: number;
  journalCount?: number;
};

/**
 * Two-part probe:
 *   1. HTTP GET `/api/health` returns 200 (delegated; pluggable for tests).
 *   2. `__drizzle_migrations` row count compared to bundled journal length.
 *
 * Returns ok=true only when both pass. `drift=true` signals (2) failed;
 * `drift=false` with ok=false signals (1) failed.
 */
export async function runHealthcheck(input: {
  databaseUrl: string;
  healthcheck?: () => Promise<{ ok: boolean; version: string }>;
}): Promise<HealthcheckResult> {
  const h = input.healthcheck ?? defaultHealth;
  let httpOk = false;
  try {
    const probe = await h();
    httpOk = probe.ok;
  } catch (err) {
    return { ok: false, drift: false, reason: `health probe error: ${(err as Error).message}` };
  }
  if (!httpOk) {
    return { ok: false, drift: false, reason: '/api/health did not return 200' };
  }

  const journal = await loadBundledJournal();
  const client = postgres(input.databaseUrl, { max: 1 });
  try {
    const cmp = await compareJournalToDb({ journal, db: drizzle(client) });
    if (cmp.drifted) {
      return {
        ok: false,
        drift: true,
        reason: cmp.driftReason ?? 'journal/db drift',
        appliedCount: cmp.applied.length,
        journalCount: journal.entries.length,
      };
    }
    return {
      ok: true,
      drift: false,
      appliedCount: cmp.applied.length,
      journalCount: journal.entries.length,
    };
  } finally {
    await client.end();
  }
}

async function defaultHealth(): Promise<{ ok: boolean; version: string }> {
  const url = `${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/api/health`;
  const r = await fetch(url);
  if (!r.ok) return { ok: false, version: '' };
  return (await r.json()) as { ok: boolean; version: string };
}
