import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE webhooks, webhook_deliveries, workspaces, users, workspace_members, sessions, accounts, audit_log RESTART IDENTITY CASCADE`;
});

// Mock the auth config so requireRole resolves the session via the test's __set.
vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

// Mock the dispatcher so the fire-and-forget setImmediate doesn't issue real
// HTTP or mutate the row mid-assertion.
vi.mock('@/lib/webhooks/dispatch', () => ({
  deliver: vi.fn(async () => {}),
}));

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function callReplay(id: string, deliveryId: string) {
  const { POST } = await import('@/app/api/webhooks/[id]/deliveries/[deliveryId]/replay/route');
  return POST(
    new Request(`http://localhost/api/webhooks/${id}/deliveries/${deliveryId}/replay`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ id, deliveryId }) },
  );
}

async function seedDelivery(workspaceId: string) {
  const db = getDb();
  const [hook] = await db
    .insert(schema.webhooks)
    .values({
      workspaceId,
      url: 'https://example.com/hook',
      events: ['page.created'],
      secret: 'cairn_whsec_seed',
    })
    .returning();
  if (!hook) throw new Error('hook insert failed');
  const [delivery] = await db
    .insert(schema.webhookDeliveries)
    .values({
      webhookId: hook.id,
      event: 'page.created',
      payload: { page: { id: 'x' } } as never,
      status: 'failed',
      attempts: 3,
      lastStatus: 500,
    })
    .returning();
  if (!delivery) throw new Error('delivery insert failed');
  return { hook, delivery };
}

describe('POST /api/webhooks/[id]/deliveries/[deliveryId]/replay', () => {
  it('re-enqueues a previously-completed delivery (202 + status reset to pending)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const { hook, delivery } = await seedDelivery(u.workspaceId);
    await setUser(u.userId);

    const res = await callReplay(hook.id, delivery.id);
    expect(res.status).toBe(202);
    const row = await getDb()
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, delivery.id));
    expect(row[0]?.status).toBe('pending');
    expect(row[0]?.attempts).toBe(0);
  });

  it('returns 404 when the delivery belongs to a webhook in another workspace', async () => {
    const mine = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const otherSeed = await seedDelivery(other.workspaceId);
    // Auth ctx is workspace 1 (mine); pass workspace-2 ids.
    await setUser(mine.userId);
    const res = await callReplay(otherSeed.hook.id, otherSeed.delivery.id);
    expect(res.status).toBe(404);
  });

  it('403 when the caller is not an admin', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const { hook, delivery } = await seedDelivery(u.workspaceId);
    await setUser(u.userId);
    const res = await callReplay(hook.id, delivery.id);
    expect(res.status).toBe(403);
  });

  it('404 when the deliveryId does not exist', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const { hook } = await seedDelivery(u.workspaceId);
    await setUser(u.userId);
    const res = await callReplay(hook.id, '00000000-0000-4000-8000-000000000999');
    expect(res.status).toBe(404);
  });

  it('mismatch: deliveryId belongs to a different webhook than the path id → 404', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const first = await seedDelivery(u.workspaceId);
    const db = getDb();
    const [h2] = await db
      .insert(schema.webhooks)
      .values({
        workspaceId: u.workspaceId,
        url: 'https://example.com/other',
        events: ['page.created'],
        secret: 'cairn_whsec_seed2',
      })
      .returning();
    if (!h2) throw new Error('hook insert failed');
    const [d2] = await db
      .insert(schema.webhookDeliveries)
      .values({
        webhookId: h2.id,
        event: 'page.created',
        payload: {} as never,
        status: 'failed',
        attempts: 1,
      })
      .returning();
    if (!d2) throw new Error('delivery insert failed');

    await setUser(u.userId);
    // Pass the first hook's id with the second hook's deliveryId.
    const res = await callReplay(first.hook.id, d2.id);
    expect(res.status).toBe(404);
  });
});
