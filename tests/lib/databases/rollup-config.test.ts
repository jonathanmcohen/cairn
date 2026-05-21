import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createProperty } from '@/lib/databases/properties';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties RESTART IDENTITY CASCADE`;
});

async function makeDb(workspaceId: string, userId: string) {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, createdBy: userId })
    .returning();
  if (!database) throw new Error('db');
  return database.id;
}

// source db has a relation -> target db; target db has a "Price" number property.
async function setup() {
  const u = await createTestWorkspaceWithUser(db);
  const target = await makeDb(u.workspaceId, u.userId);
  const source = await makeDb(u.workspaceId, u.userId);
  const price = await createProperty(db, {
    databaseId: target,
    workspaceId: u.workspaceId,
    name: 'Price',
    type: 'number',
  });
  const rel = await createProperty(db, {
    databaseId: source,
    workspaceId: u.workspaceId,
    name: 'Linked',
    type: 'relation',
    config: { targetDatabaseId: target },
  });
  return { ...u, target, source, price, rel };
}

describe('rollup property config', () => {
  it('accepts a valid { relationPropertyId, targetPropertyId, fn }', async () => {
    const s = await setup();
    const prop = await createProperty(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      name: 'Total',
      type: 'rollup',
      config: { relationPropertyId: s.rel.id, targetPropertyId: s.price.id, fn: 'sum' },
    });
    const cfg = prop.config as { relationPropertyId: string; targetPropertyId: string; fn: string };
    expect(cfg.relationPropertyId).toBe(s.rel.id);
    expect(cfg.targetPropertyId).toBe(s.price.id);
    expect(cfg.fn).toBe('sum');
  });

  it('rejects an unknown fn', async () => {
    const s = await setup();
    await expect(
      createProperty(db, {
        databaseId: s.source,
        workspaceId: s.workspaceId,
        name: 'Total',
        type: 'rollup',
        config: { relationPropertyId: s.rel.id, targetPropertyId: s.price.id, fn: 'median' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a relationPropertyId that is not a relation on this db', async () => {
    const s = await setup();
    // A non-relation property on the source db.
    const text = await createProperty(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      name: 'Notes',
      type: 'text',
    });
    await expect(
      createProperty(db, {
        databaseId: s.source,
        workspaceId: s.workspaceId,
        name: 'Total',
        type: 'rollup',
        config: { relationPropertyId: text.id, targetPropertyId: s.price.id, fn: 'sum' },
      }),
    ).rejects.toThrow(/relation/i);
  });

  it('rejects a targetPropertyId not on the relation target database', async () => {
    const s = await setup();
    // A property on the SOURCE db (wrong db — must live on the relation target).
    const wrong = await createProperty(db, {
      databaseId: s.source,
      workspaceId: s.workspaceId,
      name: 'Local',
      type: 'number',
    });
    await expect(
      createProperty(db, {
        databaseId: s.source,
        workspaceId: s.workspaceId,
        name: 'Total',
        type: 'rollup',
        config: { relationPropertyId: s.rel.id, targetPropertyId: wrong.id, fn: 'sum' },
      }),
    ).rejects.toThrow(/target/i);
  });
});
