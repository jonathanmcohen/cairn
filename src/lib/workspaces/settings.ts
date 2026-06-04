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

export type WorkspaceGeneralSettings = {
  name: string;
  requireTwofa: boolean;
  homePageId: string | null;
  icon: string | null;
};

/**
 * #1 (P0) — narrowed read for the workspace General settings page. A bare
 * `db.select()` pulls ALL 14 workspace columns; if any unrelated column lags
 * behind a pending migration on a stale deploy, Postgres throws 42703 and the
 * WHOLE page 500s (the v0.9.4 `workspaces.icon` outage). This projection reads
 * ONLY the four fields the page renders, so an unrelated lagging column can no
 * longer take the page down. Returns null when the workspace doesn't exist.
 */
export async function loadWorkspaceGeneralSettings(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceGeneralSettings | null> {
  const [row] = await db
    .select({
      name: schema.workspaces.name,
      requireTwofa: schema.workspaces.requireTwofa,
      homePageId: schema.workspaces.homePageId,
      icon: schema.workspaces.icon,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

export type UpdateWorkspaceSettingsInput = {
  workspaceId: string;
  name?: string;
  requireTwofa?: boolean;
  // undefined = leave unchanged; null = clear; string = set (validated).
  homePageId?: string | null;
  // Prefix-encoded ("emoji::🪨" / "file::<uuid>"); null clears. See
  // src/lib/pages/icon-format.ts. undefined leaves unchanged.
  icon?: string | null;
};

/**
 * Persist admin-editable workspace settings. Validates a non-empty name and that
 * any non-null home_page_id is a live page in THIS workspace. Does NOT enforce
 * require_2fa — that gate is P19 (it needs user_totp + the owner-has-2FA guard).
 *
 * The `icon` column (v0.9.4, prefix-encoded) accepts undefined=leave / null=clear /
 * string=set; no validation here beyond the route's length guard (#147).
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
    if (input.icon !== undefined) patch.icon = input.icon;
    if (Object.keys(patch).length === 0) return;

    await tx
      .update(schema.workspaces)
      .set(patch)
      .where(eq(schema.workspaces.id, input.workspaceId));
  });
}
