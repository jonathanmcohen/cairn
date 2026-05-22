import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  clearReverseLink,
  createReverseRelationProperty,
  RelationConfig,
} from '@/lib/databases/relations';
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
  await sql`TRUNCATE db_cells, db_rows, db_properties, db_views, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeDatabase(workspaceId: string, createdBy: string, name: string) {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: name, createdBy })
    .returning();
  if (!page) throw new Error('page insert failed');
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, createdBy, name })
    .returning();
  if (!d) throw new Error('database insert failed');
  return d;
}

async function makeRelationProp(databaseId: string, name: string, targetDatabaseId: string) {
  const [p] = await db
    .insert(schema.dbProperties)
    .values({ databaseId, name, type: 'relation', position: 0, config: { targetDatabaseId } })
    .returning();
  if (!p) throw new Error('property insert failed');
  return p;
}

describe('RelationConfig schema', () => {
  it('accepts a config with no reversePropertyId (plain relation)', () => {
    const parsed = RelationConfig.parse({ targetDatabaseId: crypto.randomUUID() });
    expect(parsed.reversePropertyId).toBeUndefined();
  });

  it('accepts an optional reversePropertyId', () => {
    const rev = crypto.randomUUID();
    const parsed = RelationConfig.parse({
      targetDatabaseId: crypto.randomUUID(),
      reversePropertyId: rev,
    });
    expect(parsed.reversePropertyId).toBe(rev);
  });

  it('rejects a non-uuid reversePropertyId', () => {
    expect(() =>
      RelationConfig.parse({ targetDatabaseId: crypto.randomUUID(), reversePropertyId: 'nope' }),
    ).toThrow();
  });
});

describe('createReverseRelationProperty', () => {
  it('creates a mirror on the target db and links both configs', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const dbA = await makeDatabase(u.workspaceId, u.userId, 'Tasks');
    const dbB = await makeDatabase(u.workspaceId, u.userId, 'Projects');
    const forward = await makeRelationProp(dbA.id, 'Project', dbB.id);

    const reverse = await db.transaction((tx) =>
      createReverseRelationProperty(tx, { sourcePropertyId: forward.id, reverseName: 'Tasks' }),
    );

    // mirror sits on the target database, points back at the source db
    expect(reverse.databaseId).toBe(dbB.id);
    expect(reverse.type).toBe('relation');
    expect(RelationConfig.parse(reverse.config).targetDatabaseId).toBe(dbA.id);
    expect(RelationConfig.parse(reverse.config).reversePropertyId).toBe(forward.id);

    // forward config now links to the reverse
    const [reloaded] = await db
      .select()
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.id, forward.id));
    expect(RelationConfig.parse(reloaded?.config).reversePropertyId).toBe(reverse.id);
  });

  it('throws if the source property is not a relation', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const dbA = await makeDatabase(u.workspaceId, u.userId, 'Tasks');
    const [text] = await db
      .insert(schema.dbProperties)
      .values({ databaseId: dbA.id, name: 'Title', type: 'text', position: 0, config: {} })
      .returning();
    await expect(
      db.transaction((tx) =>
        createReverseRelationProperty(tx, { sourcePropertyId: text!.id, reverseName: 'X' }),
      ),
    ).rejects.toThrow();
  });

  it('throws if the source already has a reverse', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const dbA = await makeDatabase(u.workspaceId, u.userId, 'Tasks');
    const dbB = await makeDatabase(u.workspaceId, u.userId, 'Projects');
    const forward = await makeRelationProp(dbA.id, 'Project', dbB.id);
    await db.transaction((tx) =>
      createReverseRelationProperty(tx, { sourcePropertyId: forward.id, reverseName: 'Tasks' }),
    );
    await expect(
      db.transaction((tx) =>
        createReverseRelationProperty(tx, { sourcePropertyId: forward.id, reverseName: 'Again' }),
      ),
    ).rejects.toThrow();
  });
});

describe('clearReverseLink', () => {
  it("clears the partner's reversePropertyId, degrading it to a plain relation", async () => {
    const u = await createTestWorkspaceWithUser(db);
    const dbA = await makeDatabase(u.workspaceId, u.userId, 'Tasks');
    const dbB = await makeDatabase(u.workspaceId, u.userId, 'Projects');
    const forward = await makeRelationProp(dbA.id, 'Project', dbB.id);
    const reverse = await db.transaction((tx) =>
      createReverseRelationProperty(tx, { sourcePropertyId: forward.id, reverseName: 'Tasks' }),
    );

    // Simulate deleting the reverse: clear the link on the forward partner.
    await db.transaction((tx) => clearReverseLink(tx, forward.id));

    const [reloaded] = await db
      .select()
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.id, forward.id));
    expect(RelationConfig.parse(reloaded?.config).reversePropertyId).toBeUndefined();
    // still a working plain relation
    expect(RelationConfig.parse(reloaded?.config).targetDatabaseId).toBe(dbB.id);
    // unaffected reverse row left for the caller's own delete
    expect(reverse.id).toBeTruthy();
  });

  it('is a no-op on a property that has no reverse', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const dbA = await makeDatabase(u.workspaceId, u.userId, 'Tasks');
    const dbB = await makeDatabase(u.workspaceId, u.userId, 'Projects');
    const plain = await makeRelationProp(dbA.id, 'Project', dbB.id);
    await db.transaction((tx) => clearReverseLink(tx, plain.id)); // should not throw
    const [reloaded] = await db
      .select()
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.id, plain.id));
    expect(RelationConfig.parse(reloaded?.config).reversePropertyId).toBeUndefined();
  });
});
