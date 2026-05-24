import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { encryptAuthConfig } from '@/lib/connectors/auth';
import { startPostgres, stopPostgres } from '../../../../helpers/db';
import { createTestWorkspaceWithUser } from '../../../../helpers/fixtures';

// `syncConnector` is mocked so the webhook test doesn't run the full sync
// engine — we only assert the dispatch decision.
const syncMock = vi.fn();
vi.mock('@/lib/connectors/sync', () => ({
  syncConnector: (id: string) => {
    syncMock(id);
    return Promise.resolve();
  },
}));

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
  await sql`TRUNCATE connector_conflicts, connector_row_map, database_connectors, db_cells, db_rows, db_properties, db_views, databases, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  syncMock.mockReset();
});

async function seedConnector(workspaceId: string, userId: string) {
  const [page] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!page) throw new Error('page insert failed');
  const [database] = await getDb()
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, name: 'D', createdBy: userId })
    .returning();
  if (!database) throw new Error('database insert failed');
  const [conn] = await getDb()
    .insert(schema.databaseConnectors)
    .values({
      workspaceId,
      databaseId: database.id,
      kind: 'google_sheets',
      authConfig: encryptAuthConfig({ refresh_token: 'x' }),
      syncConfig: {},
      enabled: true,
      createdBy: userId,
    })
    .returning();
  if (!conn) throw new Error('connector insert failed');
  return conn;
}

async function callWebhook(headers: Record<string, string>) {
  const { POST } = await import('@/app/api/connectors/sheets/drive-webhook/route');
  return POST(
    new Request('http://localhost/api/connectors/sheets/drive-webhook', {
      method: 'POST',
      headers,
    }) as never,
  );
}

describe('POST /api/connectors/sheets/drive-webhook', () => {
  it('returns 400 when the channel token header is missing', async () => {
    const res = await callWebhook({});
    expect(res.status).toBe(400);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the channel token is malformed (no colon)', async () => {
    const res = await callWebhook({ 'x-goog-channel-token': 'no-colon-here' });
    expect(res.status).toBe(400);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the workspaceId+connectorId pair does not resolve', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const res = await callWebhook({
      'x-goog-channel-token': `${u.workspaceId}:00000000-0000-0000-0000-000000000000`,
      'x-goog-resource-state': 'change',
    });
    expect(res.status).toBe(404);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the workspace in the token does not match the connector workspace', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(owner.workspaceId, owner.userId);
    const res = await callWebhook({
      'x-goog-channel-token': `${other.workspaceId}:${conn.id}`,
      'x-goog-resource-state': 'change',
    });
    expect(res.status).toBe(404);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 200 immediately for the initial sync ping without dispatching', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId);
    const res = await callWebhook({
      'x-goog-channel-token': `${u.workspaceId}:${conn.id}`,
      'x-goog-resource-state': 'sync',
    });
    expect(res.status).toBe(200);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 200 and dispatches syncConnector for a change ping', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId);
    const res = await callWebhook({
      'x-goog-channel-token': `${u.workspaceId}:${conn.id}`,
      'x-goog-resource-state': 'change',
    });
    expect(res.status).toBe(200);
    // setImmediate schedules the dispatch on the next tick; wait one turn.
    await new Promise((r) => setImmediate(r));
    expect(syncMock).toHaveBeenCalledWith(conn.id);
  });
});
