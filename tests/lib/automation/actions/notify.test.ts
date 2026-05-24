import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { BadConfigError } from '@/lib/automation/actions';
import { runNotify } from '@/lib/automation/actions/notify';
import { startPostgres, stopPostgres } from '../../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let userId: string;
let recipientId: string;

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

beforeEach(async () => {
  await sql`TRUNCATE notifications, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
    .returning();
  if (!u) throw new Error('user insert failed');
  userId = u.id;
  const [r] = await db
    .insert(schema.users)
    .values({ email: 'r@b.c', passwordHash: 'h', name: 'R' })
    .returning();
  if (!r) throw new Error('recipient insert failed');
  recipientId = r.id;
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('workspace insert failed');
  workspaceId = w.id;
});

describe('runNotify', () => {
  it('inserts a notification for the configured userId', async () => {
    await runNotify(
      { userId: recipientId, message: 'Row created' },
      { row: { id: 'r1' } },
      { ruleId: 'rule-1', workspaceId, createdBy: userId },
    );

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, recipientId));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error('expected one row');
    expect(row.workspaceId).toBe(workspaceId);
    expect(row.type).toBe('automation');
    const payload = row.payload as unknown as { message?: string; ruleId?: string };
    expect(payload.message).toBe('Row created');
    expect(payload.ruleId).toBe('rule-1');
  });

  it('throws BadConfigError on missing userId', async () => {
    await expect(
      runNotify({}, { row: {} }, { ruleId: 'rule-1', workspaceId, createdBy: userId }),
    ).rejects.toThrow(BadConfigError);
  });
});
