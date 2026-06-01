/**
 * v0.9.8 G4 (H) — `cli pages:purge-orphans` entry point.
 *
 * Thin shim — opens a postgres-js connection from DATABASE_URL, runs one
 * `runOrphanPurge`, returns the summary. The scheduler/operator reads the count
 * via the CLI's stdout line ("[pages:purge-orphans] dryRun=… purged=N").
 * Mirrors `runAutoUnlockCli`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { type OrphanPurgeResult, runOrphanPurge } from './orphan-purge';

export async function runOrphanPurgeCli(opts: {
  olderThanDays: number;
  dryRun: boolean;
}): Promise<OrphanPurgeResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for pages:purge-orphans');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    return await runOrphanPurge(db, opts);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
