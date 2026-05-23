import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type SettingsErrorCode = 'EMPTY_NAME' | 'HOME_PAGE_NOT_IN_WORKSPACE';

export class SettingsError extends Error {
  constructor(
    public code: SettingsErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SettingsError';
  }
}

type Db = PostgresJsDatabase<typeof schema>;

export type UpdateWorkspaceSettingsInput = {
  workspaceId: string;
  name?: string;
  requireTwofa?: boolean;
  // undefined = leave unchanged; null = clear; string = set (validated).
  homePageId?: string | null;
};

/**
 * Persist admin-editable workspace settings. Validates a non-empty name and that
 * any non-null home_page_id is a live page in THIS workspace. Does NOT enforce
 * require_2fa — that gate is P19 (it needs user_totp + the owner-has-2FA guard).
 *
 * NOTE: the original plan referenced `icon` and `default_role` columns on
 * `workspaces`, but the actual schema (see src/db/schema/workspaces.ts) has
 * neither. Per the plan's escape hatch, those branches are dropped here.
 */
export async function updateWorkspaceSettings(
  db: Db,
  input: UpdateWorkspaceSettingsInput,
): Promise<void> {
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new SettingsError('EMPTY_NAME', 'Workspace name cannot be empty');
  }

  await db.transaction(async (tx) => {
    if (input.homePageId) {
      const [p] = await tx
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, input.homePageId),
            eq(schema.pages.workspaceId, input.workspaceId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!p) {
        throw new SettingsError(
          'HOME_PAGE_NOT_IN_WORKSPACE',
          'Home page must be a live page in this workspace',
        );
      }
    }

    const patch: Partial<typeof schema.workspaces.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.requireTwofa !== undefined) patch.requireTwofa = input.requireTwofa;
    if (input.homePageId !== undefined) patch.homePageId = input.homePageId;
    if (Object.keys(patch).length === 0) return;

    await tx
      .update(schema.workspaces)
      .set(patch)
      .where(eq(schema.workspaces.id, input.workspaceId));
  });
}
