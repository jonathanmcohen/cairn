import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

export type ArchiveDatabaseErrorCode = 'NOT_FOUND';

export class ArchiveDatabaseError extends Error {
  constructor(
    public code: ArchiveDatabaseErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ArchiveDatabaseError';
  }
}

/**
 * Archive (soft-delete) a database scoped to a workspace. The update + the
 * `database.deleted` audit row are written in a single transaction so the
 * audit can never drift from the action (spec §2.27). Cross-workspace ids
 * throw `NOT_FOUND` so we don't leak existence.
 */
export async function archiveDatabase(
  db: PostgresJsDatabase<typeof schema>,
  input: { databaseId: string; workspaceId: string; actorUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.databases)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.databases.id, input.databaseId),
          eq(schema.databases.workspaceId, input.workspaceId),
        ),
      )
      .returning({ id: schema.databases.id });
    if (updated.length === 0) throw new ArchiveDatabaseError('NOT_FOUND');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'database.deleted',
      targetType: 'database',
      targetId: input.databaseId,
    });
  });
}
