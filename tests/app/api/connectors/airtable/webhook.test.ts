import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { encryptAuthConfig } from '@/lib/connectors/auth';
import { startPostgres, stopPostgres } from '../../../../helpers/db';
import { createTestWorkspaceWithUser } from '../../../../helpers/fixtures';

// Mock the sync engine so the webhook test only asserts the dispatch decision.
const syncMock = vi.fn();
vi.mock('@/lib/connectors/sync', () => ({
  syncConnector: (id: string) => {
    syncMock(id);
    return Promise.resolve();
  },
}));

let sql: ReturnType<typeof postgres>;

const macSecretB64 = Buffer.from('mac-secret-bytes-airtable').toString('base64');

function signedBody(body: string, secretB64: string = macSecretB64): string {
  return createHmac('sha256', Buffer.from(secretB64, 'base64')).update(body).digest('base64');
}

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'test-auth-secret-thirty-two-chars-min-aaaaaa';
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

async function seedConnector(workspaceId: string, userId: string, withMac = true) {
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
      kind: 'airtable',
      authConfig: encryptAuthConfig(
        withMac ? { pat: 'pat-x', webhookMacSecret: macSecretB64 } : { pat: 'pat-x' },
      ),
      syncConfig: { baseId: 'appX', tableId: 'tblX', fieldMap: {}, externalIdProperty: '' },
      enabled: true,
      createdBy: userId,
    })
    .returning();
  if (!conn) throw new Error('connector insert failed');
  return conn;
}

async function callWebhook(
  workspaceId: string | null,
  connectorId: string | null,
  body: string,
  headers: Record<string, string>,
) {
  const { POST } = await import('@/app/api/connectors/airtable/webhook/route');
  const qs =
    workspaceId !== null && connectorId !== null
      ? `?w=${encodeURIComponent(workspaceId)}&c=${encodeURIComponent(connectorId)}`
      : workspaceId !== null
        ? `?w=${encodeURIComponent(workspaceId)}`
        : '';
  return POST(
    new Request(`http://localhost/api/connectors/airtable/webhook${qs}`, {
      method: 'POST',
      headers,
      body,
    }) as never,
  );
}

describe('POST /api/connectors/airtable/webhook', () => {
  it('returns 400 when query identifiers are missing', async () => {
    const res = await callWebhook(null, null, '{}', {});
    expect(res.status).toBe(400);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the X-Airtable-Content-MAC header is missing', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId);
    const res = await callWebhook(u.workspaceId, conn.id, '{"x":1}', {});
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the HMAC is malformed (wrong prefix)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId);
    const res = await callWebhook(u.workspaceId, conn.id, '{"x":1}', {
      'x-airtable-content-mac': 'sha256=AAAA',
    });
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the HMAC value does not match', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId);
    const body = '{"x":1}';
    const res = await callWebhook(u.workspaceId, conn.id, body, {
      'x-airtable-content-mac': 'hmac-sha256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the connector has no MAC secret stored', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId, false);
    const body = '{"x":1}';
    const res = await callWebhook(u.workspaceId, conn.id, body, {
      'x-airtable-content-mac': `hmac-sha256=${signedBody(body)}`,
    });
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the workspace+connector pair does not resolve', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const body = '{"x":1}';
    const res = await callWebhook(u.workspaceId, '00000000-0000-0000-0000-000000000000', body, {
      'x-airtable-content-mac': `hmac-sha256=${signedBody(body)}`,
    });
    expect(res.status).toBe(404);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the workspace in the query does not match the connector workspace', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(owner.workspaceId, owner.userId);
    const body = '{"x":1}';
    const res = await callWebhook(other.workspaceId, conn.id, body, {
      'x-airtable-content-mac': `hmac-sha256=${signedBody(body)}`,
    });
    expect(res.status).toBe(404);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 200 and dispatches syncConnector on a valid HMAC', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId);
    const body = '{"x":1}';
    const res = await callWebhook(u.workspaceId, conn.id, body, {
      'x-airtable-content-mac': `hmac-sha256=${signedBody(body)}`,
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(syncMock).toHaveBeenCalledWith(conn.id);
  });

  it('HMAC validates against the raw request bytes (not re-serialized JSON)', async () => {
    // Construct a body with surprising whitespace/key order so re-serialization
    // would produce a different signature.
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const conn = await seedConnector(u.workspaceId, u.userId);
    const body = '{"b":2,  "a":1  }';
    const res = await callWebhook(u.workspaceId, conn.id, body, {
      'x-airtable-content-mac': `hmac-sha256=${signedBody(body)}`,
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(syncMock).toHaveBeenCalledWith(conn.id);
  });
});
