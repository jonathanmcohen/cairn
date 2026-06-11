import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { appVersion } from '@/lib/version';

// v0.10.0 H4d — DELIBERATE CONTRACT: this endpoint ALWAYS answers 200 and
// signals degradation in the body (`status: 'degraded'`, `db: 'down'`).
// Consumers must read the body, not the status code. Readiness probing (503
// on db-down so a load balancer sheds traffic) belongs to /healthz — do not
// add a 503 branch here. See docs/operations.md § "Health endpoints".
export async function GET(): Promise<Response> {
  let dbStatus: 'ok' | 'down' = 'down';
  try {
    await getDb().execute(sql`SELECT 1`);
    dbStatus = 'ok';
  } catch {
    dbStatus = 'down';
  }
  return NextResponse.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    version: appVersion(),
    db: dbStatus,
  });
}
