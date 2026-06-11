import { parseDbUrl } from '@/server/cli-internal';

/**
 * v0.10.0 C2 — database name exactly as the backup/restore CLI sees it.
 *
 * The restore route's retype gate compares the admin's typed confirmation
 * against this, so it MUST use the same parser as `cli restore`
 * (src/server/cli-internal.ts parseDbUrl) — a divergent parse (e.g. around
 * percent-encoding) would make the confirmation impossible or, worse, let a
 * mistyped name through.
 */
export function databaseNameFromUrl(databaseUrl: string): string {
  return parseDbUrl(databaseUrl).database;
}
