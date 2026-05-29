import { randomBytes } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { registerTrashPurgeCron } from '@/server/cron-register';

export type CreateWorkspaceInput = {
  name: string;
  ownerUserId: string;
  icon?: string | null;
};

/** slugify(name) + 6 hex chars — the random suffix avoids collisions (no retry). */
function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 53);
  const suffix = randomBytes(3).toString('hex');
  return `${base || 'workspace'}-${suffix}`;
}

/**
 * Create a workspace and make `ownerUserId` its owner, atomically.
 * Generalizes the v0.1.0 signup bootstrap; used by signup AND POST /api/workspaces.
 *
 * v0.9.0 G2 P13 — also registers the per-workspace `trash:purge` cron row so
 * the v0.7 P14 scheduler starts auto-purging trashed pages on the daily 03:00
 * UTC tick. Wrapped in the same transaction so the workspace either lands
 * with a schedule or doesn't land at all.
 */
export async function createWorkspace(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateWorkspaceInput,
): Promise<schema.Workspace> {
  return db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({ name: input.name, slug: slugFor(input.name), icon: input.icon ?? null })
      .returning();
    if (!ws) throw new Error('Failed to create workspace');
    await tx
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: input.ownerUserId, role: 'owner' });
    await registerTrashPurgeCron(tx, { workspaceId: ws.id });
    return ws;
  });
}
