import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { updateWorkspaceSettings } from '@/lib/workspaces/settings';
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
  await sql`TRUNCATE workspaces RESTART IDENTITY CASCADE`;
});

async function insertWorkspace(values: { name: string; slug: string; icon?: string }) {
  const rows = await db.insert(schema.workspaces).values(values).returning();
  const ws = rows[0];
  if (!ws) throw new Error('insert returned no workspace');
  return ws;
}

async function readWorkspace(id: string) {
  const rows = await db
    .select({ icon: schema.workspaces.icon, name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, id));
  const row = rows[0];
  if (!row) throw new Error('workspace not found');
  return row;
}

describe('updateWorkspaceSettings — icon', () => {
  it('sets a prefix-encoded icon and clears it with null', async () => {
    const ws = await insertWorkspace({ name: 'Acme', slug: 'acme' });

    await updateWorkspaceSettings(db, { workspaceId: ws.id, icon: 'emoji::🪨' });
    expect((await readWorkspace(ws.id)).icon).toBe('emoji::🪨');

    await updateWorkspaceSettings(db, { workspaceId: ws.id, icon: null });
    expect((await readWorkspace(ws.id)).icon).toBeNull();
  });

  it('leaves icon unchanged when the field is omitted', async () => {
    const ws = await insertWorkspace({ name: 'Acme', slug: 'acme', icon: 'emoji::🟢' });
    await updateWorkspaceSettings(db, { workspaceId: ws.id, name: 'Renamed' });
    const row = await readWorkspace(ws.id);
    expect(row.icon).toBe('emoji::🟢');
    expect(row.name).toBe('Renamed');
  });
});
