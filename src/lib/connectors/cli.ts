import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { logger } from '@/lib/observability/logger';
import { syncConnector } from './sync';

/**
 * CLI entry: sync one connector (by id) or every enabled one. Designed for
 * single-instance invocation — running twice concurrently double-pushes.
 * Operators wire it through the cron table from G5 P14.
 */
export async function runConnectorSync(opts: { connectorId?: string }): Promise<void> {
  const db = getDb();
  let ids: string[];
  if (opts.connectorId) {
    ids = [opts.connectorId];
  } else {
    const rows = await db
      .select({ id: schema.databaseConnectors.id })
      .from(schema.databaseConnectors)
      .where(eq(schema.databaseConnectors.enabled, true));
    ids = rows.map((r) => r.id);
  }

  for (const id of ids) {
    try {
      await syncConnector(id);
      logger.info({ connectorId: id }, '[connectors] sync ok');
    } catch (err) {
      logger.error(
        {
          connectorId: id,
          err: err instanceof Error ? { message: err.message, name: err.name } : err,
        },
        '[connectors] sync failed',
      );
    }
  }
}
