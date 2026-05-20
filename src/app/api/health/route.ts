import { getDb } from '@/db/client';
import { appVersion } from '@/lib/version';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

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
