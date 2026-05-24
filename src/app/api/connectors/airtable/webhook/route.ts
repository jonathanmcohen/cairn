import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { decryptAuthConfig } from '@/lib/connectors/auth';
import { syncConnector } from '@/lib/connectors/sync';
import { logger } from '@/lib/observability/logger';

/**
 * POST `/api/connectors/airtable/webhook?w=<workspaceId>&c=<connectorId>`
 *
 * Receives Airtable's webhook push when the watched base+table changes.
 * Airtable signs each delivery with `X-Airtable-Content-MAC` formatted as
 * `hmac-sha256=<base64>`, where the MAC is HMAC-SHA256 over the raw request
 * body keyed by the per-webhook MAC secret returned at registration.
 *
 * Posture:
 *  - Missing/malformed/wrong MAC                → 401 (no body indication of which)
 *  - Connector not found in *this* workspace    → 404 (existence-non-leak; mirrors
 *                                                  v0.5 P2 webhook + v0.6 sharing + P20)
 *  - Valid                                      → 200, fire-and-forget `syncConnector`
 *
 * The MAC is validated against the *raw* request bytes via `req.text()` — never
 * re-serialized JSON, because Airtable's signature is over the literal payload.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('w');
  const connectorId = url.searchParams.get('c');
  if (!workspaceId || !connectorId) {
    return NextResponse.json({ error: 'missing identifiers' }, { status: 400 });
  }

  const macHeader = req.headers.get('x-airtable-content-mac');
  if (!macHeader) {
    return NextResponse.json({ error: 'missing mac' }, { status: 401 });
  }

  // Read raw body bytes — HMAC is computed over the literal payload, never
  // a re-serialized representation.
  const raw = await req.text();

  const db = getDb();
  const [conn] = await db
    .select({
      id: schema.databaseConnectors.id,
      authConfig: schema.databaseConnectors.authConfig,
    })
    .from(schema.databaseConnectors)
    .where(
      and(
        eq(schema.databaseConnectors.id, connectorId),
        eq(schema.databaseConnectors.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!conn) {
    // Existence-non-leak — 404 even on cross-workspace receipt.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const authPlain = decryptAuthConfig(conn.authConfig) as {
    webhookMacSecret?: string;
  };
  if (!authPlain.webhookMacSecret) {
    return NextResponse.json({ error: 'no mac configured' }, { status: 401 });
  }

  // Header form: `hmac-sha256=<base64>`.
  const m = /^hmac-sha256=(.+)$/.exec(macHeader);
  if (!m?.[1]) {
    return NextResponse.json({ error: 'bad mac header' }, { status: 401 });
  }

  const expected = createHmac('sha256', Buffer.from(authPlain.webhookMacSecret, 'base64'))
    .update(raw)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(m[1], 'base64');
  } catch {
    return NextResponse.json({ error: 'invalid mac' }, { status: 401 });
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'invalid mac' }, { status: 401 });
  }

  // Fire-and-forget: never block the webhook ack on adapter work.
  setImmediate(() => {
    syncConnector(connectorId).catch((err) => {
      logger.error({ connectorId, err }, '[connectors/airtable] webhook-triggered sync failed');
    });
  });

  return NextResponse.json({ ok: true });
}
