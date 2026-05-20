import { randomBytes } from 'node:crypto';
import * as schema from '@/db/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

let counter = 0;

function uniqueSlug(prefix = 'ws'): string {
  counter += 1;
  return `${prefix}-${counter}-${randomBytes(3).toString('hex')}`;
}

export type TestUser = {
  workspaceId: string;
  userId: string;
  role: schema.MemberRole;
};

/**
 * Create a workspace + user + membership in one go, for tests.
 * Returns ids ready to plug into requireRole-mocked sessions.
 */
export async function createTestWorkspaceWithUser(
  db: PostgresJsDatabase<typeof schema>,
  opts: { role?: schema.MemberRole; email?: string; workspaceName?: string } = {},
): Promise<TestUser> {
  const role = opts.role ?? 'owner';
  const slug = uniqueSlug();
  const name = opts.workspaceName ?? `Workspace ${slug}`;
  const email = opts.email ?? `${role}-${slug}@example.com`;

  const [ws] = await db.insert(schema.workspaces).values({ name, slug }).returning();
  if (!ws) throw new Error('failed to create workspace');
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: role })
    .returning();
  if (!u) throw new Error('failed to create user');
  await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role });

  return { workspaceId: ws.id, userId: u.id, role };
}
