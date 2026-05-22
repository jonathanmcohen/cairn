import { inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { deliver } from './dispatch';

/**
 * Re-attempt deliveries left in a non-terminal state by a previous process
 * (in-process dispatch loses setImmediate-scheduled work on restart — §8).
 * Returns the number of deliveries re-scheduled. Each is fired off the hot
 * path; failures are swallowed (status is tracked per row).
 */
export async function sweepPendingDeliveries(): Promise<number> {
  const stuck = await getDb()
    .select({ id: schema.webhookDeliveries.id })
    .from(schema.webhookDeliveries)
    .where(inArray(schema.webhookDeliveries.status, ['pending', 'failed']));

  for (const { id } of stuck) {
    setImmediate(() => {
      void deliver(id).catch(() => {});
    });
  }
  return stuck.length;
}
