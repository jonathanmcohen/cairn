import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { appVersion } from '@/lib/version';

// Always-open liveness endpoint. NO auth, NO token gate. Suitable for K8s
// liveness probes and load-balancer health checks at the root path.
//
// CONTRACT (spec §2.8 + §3 G3):
//   GET /healthz → 200 { status: 'ok',       version, db: 'ok',          uptime_seconds }
//                  503 { status: 'degraded', version, db: 'unreachable', uptime_seconds }
//
// The DB touch is a cheap `SELECT 1`; on connection failure the route returns
// 503 so the LB sheds traffic from a broken replica.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const START_TIME_MS = Date.now();

function uptimeSeconds(): number {
  return Math.floor((Date.now() - START_TIME_MS) / 1000);
}

export async function GET(): Promise<Response> {
  let dbStatus: 'ok' | 'unreachable' = 'unreachable';
  try {
    await getDb().execute(sql`SELECT 1`);
    dbStatus = 'ok';
  } catch {
    dbStatus = 'unreachable';
  }
  const body = {
    status: dbStatus === 'ok' ? ('ok' as const) : ('degraded' as const),
    version: appVersion(),
    db: dbStatus,
    uptime_seconds: uptimeSeconds(),
  };
  return NextResponse.json(body, { status: dbStatus === 'ok' ? 200 : 503 });
}
