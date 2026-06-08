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

// Postgres "undefined_column" — raised when a SELECT names a column the live DB
// doesn't actually have. On a stale deploy whose schema predates a migration,
// this is the 42703 that 500s an otherwise-fine page (the v0.9.4 `icon` outage).
const PG_UNDEFINED_COLUMN = '42703';

function isUndefinedColumnError(err: unknown): boolean {
  // Drizzle 0.45 wraps the driver error in a DrizzleQueryError, so the Postgres
  // `code` lives on `.cause` (sometimes nested) rather than the top-level Error.
  // Walk the cause chain so we match the real 42703 wherever it surfaces.
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 5; depth += 1) {
    if (
      typeof cur === 'object' &&
      'code' in cur &&
      (cur as { code?: unknown }).code === PG_UNDEFINED_COLUMN
    ) {
      return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * #1 — settings General loader, hardened against MIGRATION DRIFT (v0.9.15).
 *
 * The page renders four fields. Three of them — name (0001), require_2fa /
 * home_page_id (0021) — have existed since the earliest releases and are safe to
 * project directly. The fourth, `icon`, was added in migration 0054 (v0.9.4). A
 * prod DB deployed BEFORE 0054 ran still has workspace rows but no `icon` column,
 * so selecting it throws Postgres 42703 ("column does not exist") and the WHOLE
 * settings RSC segment 500s. The earlier "narrowed projection" still SELECTed
 * `icon` in the same query, so it did NOT survive that drift (reproduced in
 * tests/settings/workspace-general-load.spec.ts).
 *
 * Fix: read the always-present core columns in one query, then read `icon`
 * separately and SWALLOW a 42703 there (treating icon as null). The page renders
 * on a stale deploy; once migrations run on the next redeploy (they do, via
 * src/server/entrypoint.ts), `icon` simply starts populating again — no code
 * change needed to recover. Returns null only when the workspace row is absent.
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
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!row) return null;

  return { ...row, icon: await loadWorkspaceIcon(db, workspaceId) };
}

/**
 * Read `workspaces.icon` (migration 0054), tolerating a stale schema that lacks
 * the column: a 42703 here means the deploy predates 0054, so we return null
 * rather than letting it bubble up and 500 the page. Any OTHER error re-throws —
 * we only paper over the specific known drift, never a real query/DB fault.
 */
async function loadWorkspaceIcon(db: Db, workspaceId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ icon: schema.workspaces.icon })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);
    return row?.icon ?? null;
  } catch (err) {
    if (isUndefinedColumnError(err)) return null;
    throw err;
  }
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
