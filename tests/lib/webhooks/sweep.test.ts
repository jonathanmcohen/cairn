import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import * as dispatch from '@/lib/webhooks/dispatch';
import { sweepPendingDeliveries } from '@/lib/webhooks/sweep';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => stopPostgres());
afterEach(() => vi.restoreAllMocks());

describe('startup webhook sweep', () => {
  it('re-attempts pending and failed deliveries, ignores success', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const [hook] = await getDb()
      .insert(schema.webhooks)
      .values({
        workspaceId: u.workspaceId,
        url: 'https://x/y',
        events: ['page.created'],
        secret: 's',
      })
      .returning();
    if (!hook) throw new Error('hook insert failed');
    const ids: Record<string, string> = {};
    for (const status of ['pending', 'failed', 'success'] as const) {
      const [d] = await getDb()
        .insert(schema.webhookDeliveries)
        .values({ webhookId: hook.id, event: 'page.created', payload: {}, status })
        .returning();
      if (!d) throw new Error('delivery insert failed');
      ids[status] = d.id;
    }

    const deliverSpy = vi.spyOn(dispatch, 'deliver').mockResolvedValue(undefined);
    const n = await sweepPendingDeliveries();
    await new Promise((r) => setImmediate(r));

    expect(n).toBe(2);
    expect(deliverSpy).toHaveBeenCalledWith(ids.pending);
    expect(deliverSpy).toHaveBeenCalledWith(ids.failed);
    expect(deliverSpy).not.toHaveBeenCalledWith(ids.success);
  });
});
