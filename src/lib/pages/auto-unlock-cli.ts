/**
 * v0.9.0 G2 P14 — `cli pages:auto-unlock` entry point.
 *
 * Thin shim — opens a postgres-js connection, runs one
 * `runAutoUnlockSweep`, returns the count. The scheduler logs the count
 * via the CLI's stdout line ("[pages:auto-unlock] unlocked=N").
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { type AutoUnlockResult, runAutoUnlockSweep } from './auto-unlock';

export async function runAutoUnlockCli(): Promise<AutoUnlockResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for pages:auto-unlock');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    return await runAutoUnlockSweep(db);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
