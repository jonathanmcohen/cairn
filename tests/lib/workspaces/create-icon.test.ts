import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createWorkspace } from '@/lib/workspaces/create';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeUser(email = 'o@x.com') {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: 'O' })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}

describe('createWorkspace icon', () => {
  it('persists the prefix-encoded icon when supplied', async () => {
    const userId = await makeUser();
    const ws = await createWorkspace(db, {
      name: 'Acme',
      ownerUserId: userId,
      icon: 'emoji::🪨',
    });
    const [row] = await db
      .select({ icon: schema.workspaces.icon })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws.id));
    expect(row?.icon).toBe('emoji::🪨');
  });

  it('leaves icon null when omitted (signup back-compat)', async () => {
    const userId = await makeUser();
    const ws = await createWorkspace(db, { name: 'NoIcon', ownerUserId: userId });
    const [row] = await db
      .select({ icon: schema.workspaces.icon })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws.id));
    expect(row?.icon).toBeNull();
  });
});
