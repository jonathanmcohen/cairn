import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type UpdateUserProfileInput = {
  userId: string;
  name?: string;
  avatarUrl?: string | null;
};

/**
 * v0.9.9 K4/K5 #198/#199 — pure, db-injected profile mutation. Trims + length-
 * checks the display name, accepts an avatar URL (or null to clear). Throws on
 * invalid input so the route maps it to a 400.
 */
export async function updateUserProfile(
  db: PostgresJsDatabase<typeof schema>,
  input: UpdateUserProfileInput,
): Promise<schema.User> {
  const patch: Partial<schema.NewUser> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new Error('name must be 1–200 characters');
    }
    patch.name = trimmed;
  }
  if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
  if (Object.keys(patch).length === 0) throw new Error('no fields to update');
  const [user] = await db
    .update(schema.users)
    .set(patch)
    .where(eq(schema.users.id, input.userId))
    .returning();
  if (!user) throw new Error('user not found');
  return user;
}
