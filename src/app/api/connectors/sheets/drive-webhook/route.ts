import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { syncConnector } from '@/lib/connectors/sync';
import { logger } from '@/lib/observability/logger';

/**
 * POST `/api/connectors/sheets/drive-webhook`
 *
 * Drive sends a notification with these headers when the watched file changes:
 *   - `x-goog-channel-id`        the channel id we passed on watch()
 *   - `x-goog-resource-id`       opaque resource handle
 *   - `x-goog-channel-token`     our token = `${workspaceId}:${connectorId}`
 *   - `x-goog-resource-state`    'sync' (initial), 'change' (update), 'remove'
 *
 * The body is empty for change pings. We recover `(workspaceId, connectorId)`
 * from the token, validate it resolves to a live connector in that workspace,
 * then fire `syncConnector(connectorId)` and return 200 immediately.
 *
 * Cross-workspace receipts return **404** (not 403) — matches the v0.5 P2
 * webhook and v0.6 sharing existence-non-leak posture.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-goog-channel-token');
  const resourceState = req.headers.get('x-goog-resource-state');
  if (!token) return NextResponse.json({ error: 'missing channel token' }, { status: 400 });

  const [workspaceId, connectorId] = token.split(':');
  if (!workspaceId || !connectorId) {
    return NextResponse.json({ error: 'malformed token' }, { status: 400 });
  }

  const db = getDb();
  const [conn] = await db
    .select({ id: schema.databaseConnectors.id })
    .from(schema.databaseConnectors)
    .where(
      and(
        eq(schema.databaseConnectors.id, connectorId),
        eq(schema.databaseConnectors.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!conn) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Drive sends a 'sync' ping on channel creation — no actual change yet.
  if (resourceState === 'sync') {
    return NextResponse.json({ ok: true });
  }

  // Fire-and-forget: never block the webhook ack on adapter work.
  setImmediate(() => {
    syncConnector(connectorId).catch((err) => {
      logger.error({ connectorId, err }, '[connectors/sheets] webhook-triggered sync failed');
    });
  });

  return NextResponse.json({ ok: true });
}
