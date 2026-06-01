import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { decryptAuthConfig } from '@/lib/connectors/auth';
import { createConnector } from '@/lib/connectors/manage';
import { startPostgres, stopPostgres } from '../../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

beforeEach(async () => {
  await sql`TRUNCATE connector_conflicts, connector_row_map, database_connectors, db_properties, databases, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
});

async function seedAdminConnector(kind: schema.ConnectorKind) {
  const [u] = await db
    .insert(schema.users)
    .values({ email: `a${Math.random()}@b.c`, name: 'A', passwordHash: 'x' })
    .returning();
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: `ws-${u!.id}` })
    .returning();
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: w!.id, userId: u!.id, role: 'admin' });
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId: w!.id, title: 'P', createdBy: u!.id })
    .returning();
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: w!.id, pageId: page!.id, name: 'D', createdBy: u!.id })
    .returning();
  const conn = await createConnector(db, {
    workspaceId: w!.id,
    databaseId: database!.id,
    kind,
    createdBy: u!.id,
  });
  return { userId: u!.id, workspaceId: w!.id, connectorId: conn.id };
}

describe('PATCH /api/connectors/[connectorId]', () => {
  it('401 when unauthenticated', async () => {
    const { connectorId } = await seedAdminConnector('csv');
    const { PATCH } = await import('@/app/api/connectors/[connectorId]/route');
    const res = await PATCH(
      new Request(`http://x/api/connectors/${connectorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ syncConfig: { relativePath: 'x.csv' }, enabled: true }),
      }) as never,
      { params: Promise.resolve({ connectorId }) },
    );
    expect(res.status).toBe(401);
  });

  it('saves syncConfig + enabled for an admin (no authConfig sent)', async () => {
    const { userId, connectorId } = await seedAdminConnector('csv');
    await setUser(userId);
    const { PATCH } = await import('@/app/api/connectors/[connectorId]/route');
    const res = await PATCH(
      new Request(`http://x/api/connectors/${connectorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          syncConfig: { relativePath: 'x.csv', delimiter: ',' },
          enabled: true,
        }),
      }) as never,
      { params: Promise.resolve({ connectorId }) },
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.databaseConnectors)
      .where(eq(schema.databaseConnectors.id, connectorId));
    expect(row?.syncConfig).toEqual({ relativePath: 'x.csv', delimiter: ',' });
    expect(row?.enabled).toBe(true);
    expect(decryptAuthConfig(row!.authConfig)).toEqual({});
  });

  it('encrypts authConfig when present (Airtable PAT)', async () => {
    const { userId, connectorId } = await seedAdminConnector('airtable');
    await setUser(userId);
    const { PATCH } = await import('@/app/api/connectors/[connectorId]/route');
    await PATCH(
      new Request(`http://x/api/connectors/${connectorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          authConfig: { pat: 'patSECRET' },
          syncConfig: { baseId: 'appX', tableId: 'tblY' },
          enabled: true,
        }),
      }) as never,
      { params: Promise.resolve({ connectorId }) },
    );
    const [row] = await db
      .select()
      .from(schema.databaseConnectors)
      .where(eq(schema.databaseConnectors.id, connectorId));
    expect(decryptAuthConfig(row!.authConfig)).toEqual({ pat: 'patSECRET' });
    expect(row!.authConfig.toString('utf8')).not.toContain('patSECRET');
  });

  it('404 for a connector outside the caller workspace', async () => {
    const a = await seedAdminConnector('csv');
    const b = await seedAdminConnector('csv');
    await setUser(b.userId);
    const { PATCH } = await import('@/app/api/connectors/[connectorId]/route');
    const res = await PATCH(
      new Request(`http://x/api/connectors/${a.connectorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ syncConfig: {}, enabled: true }),
      }) as never,
      { params: Promise.resolve({ connectorId: a.connectorId }) },
    );
    expect(res.status).toBe(404);
  });
});
