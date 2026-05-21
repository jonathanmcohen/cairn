import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type UserWorkspace = {
  id: string;
  name: string;
  role: schema.MemberRole;
};

/** List the workspaces a user belongs to (oldest membership first), with their role in each. */
export async function listUserWorkspaces(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<UserWorkspace[]> {
  return db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaceMembers.joinedAt));
}
