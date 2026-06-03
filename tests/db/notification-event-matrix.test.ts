import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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

describe('notification event matrix (#195, migration 0067)', () => {
  it('accepts a page_approval notification row (type is free-text)', async () => {
    const { workspaceId, userId } = await createTestWorkspaceWithUser(db);
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId, title: 'P', createdBy: userId })
      .returning({ id: schema.pages.id });
    if (!page) throw new Error('page insert failed');

    const [row] = await db
      .insert(schema.notifications)
      .values({
        userId,
        workspaceId,
        type: 'page_approval',
        payload: { pageId: page.id, actorId: userId, decision: 'approved' },
      })
      .returning();
    expect(row?.type).toBe('page_approval');
  });

  it('0067 seeds the three new per-type prefs for every workspace member', async () => {
    const { workspaceId, userId } = await createTestWorkspaceWithUser(db);

    // Re-run the 0067 seed SQL against the seeded member (the migration itself
    // back-fills members that existed at migrate() time; here we exercise the
    // same idempotent INSERT … ON CONFLICT DO NOTHING for a member created
    // after the migration ran).
    const seedSql = readFileSync(
      join(process.cwd(), 'drizzle/migrations/0067_notification_event_matrix.sql'),
      'utf8',
    );
    await sql.unsafe(seedSql);

    const rows = await db
      .select()
      .from(schema.notificationEmailPrefs)
      .where(
        and(
          eq(schema.notificationEmailPrefs.userId, userId),
          eq(schema.notificationEmailPrefs.workspaceId, workspaceId),
          inArray(schema.notificationEmailPrefs.notificationType, [
            'page_approval',
            'page_status',
            'page_lock',
          ]),
        ),
      );
    expect(rows).toHaveLength(3);
    // Opt-in defaults: both flags false.
    for (const r of rows) {
      expect(r.emailEnabled).toBe(false);
      expect(r.digestOnly).toBe(false);
    }

    // Idempotent — re-running the seed does not duplicate.
    await sql.unsafe(seedSql);
    const again = await db
      .select()
      .from(schema.notificationEmailPrefs)
      .where(
        and(
          eq(schema.notificationEmailPrefs.userId, userId),
          eq(schema.notificationEmailPrefs.workspaceId, workspaceId),
          inArray(schema.notificationEmailPrefs.notificationType, [
            'page_approval',
            'page_status',
            'page_lock',
          ]),
        ),
      );
    expect(again).toHaveLength(3);
  });
});
