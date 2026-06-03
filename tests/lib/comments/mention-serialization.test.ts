import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE comments, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

// E2 (#73/#253) bisection — lib layer. Confirms createComment + the POST
// z.string() parse store the body verbatim, so a mention followed by trailing
// text survives the write path end-to-end. Regression guard.
describe('createComment preserves text after an @-mention', () => {
  it('stores the full body verbatim including trailing text', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    // Seed a real mentioned user so the notification-FK on insert is satisfied;
    // the test asserts the body is stored verbatim regardless.
    const [mentioned] = await db
      .insert(schema.users)
      .values({ email: `jon-${crypto.randomUUID()}@example.com`, passwordHash: 'h', name: 'Jon' })
      .returning();
    if (!mentioned) throw new Error('failed to create mentioned user');
    const mentionId = mentioned.id;
    const body = `@[Jon](${mentionId}) and the rest`;

    const { comment, mentionedUserIds } = await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body,
      target: { type: 'page', id: p.id },
    });

    expect(comment.body).toBe(body);
    expect(mentionedUserIds).toEqual([mentionId]);
  });
});
