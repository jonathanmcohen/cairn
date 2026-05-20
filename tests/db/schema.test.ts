import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

describe('workspaces / users / workspace_members', () => {
  it('inserts a workspace, a user, and a membership row', async () => {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'Acme', slug: 'acme' })
      .returning();
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
      .returning();
    if (!ws || !u) throw new Error('insert returned no rows');
    const [m] = await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: u.id, role: 'owner' })
      .returning();
    if (!m) throw new Error('membership insert returned no rows');

    expect(m.role).toBe('owner');

    const found = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, u.id));
    expect(found).toHaveLength(1);
  });

  it('rejects duplicate user emails', async () => {
    await db.insert(schema.users).values({ email: 'dup@x.com', passwordHash: 'h', name: 'A' });
    await expect(
      db.insert(schema.users).values({ email: 'dup@x.com', passwordHash: 'h', name: 'B' }),
    ).rejects.toThrow();
  });
});
