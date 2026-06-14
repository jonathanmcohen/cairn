import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Flashcard workspace settings — schedule defaults, leech threshold, and
 * optional daily reminder (v0.10.2 F3 Task A).
 *
 * The "settings" row is optional: workspaces that have never been configured
 * get synthesized defaults so callers never have to handle null. All mutation
 * goes through `upsertWorkspaceFlashcardSettings` which validates ranges before
 * writing to avoid nonsense values (e.g. ease_start < 1.3).
 */

export type WorkspaceFlashcardSettingsRow = typeof schema.workspaceFlashcardSettings.$inferSelect;

/** Synthesized defaults returned when no settings row exists yet. */
export const DEFAULT_FLASHCARD_SETTINGS = {
  newPerDay: 20,
  reviewLimit: 200,
  easeStart: 2.5,
  leechThreshold: 8,
  reminderHour: null as number | null,
  defaultDeckId: null as string | null,
} as const;

type Db = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'update'>;

/**
 * Return the workspace's flashcard settings row, or a synthesized default
 * object if no row exists yet. Never throws on missing.
 *
 * The synthesized object's shape matches `WorkspaceFlashcardSettingsRow` for
 * schedule fields; `workspaceId`/`createdAt`/`updatedAt` are omitted because
 * they have no useful default.
 */
export async function getWorkspaceFlashcardSettings(
  db: Db,
  workspaceId: string,
): Promise<
  WorkspaceFlashcardSettingsRow | (typeof DEFAULT_FLASHCARD_SETTINGS & { workspaceId?: string })
> {
  const [row] = await db
    .select()
    .from(schema.workspaceFlashcardSettings)
    .where(eq(schema.workspaceFlashcardSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? DEFAULT_FLASHCARD_SETTINGS;
}

export type FlashcardSettingsPatch = {
  defaultDeckId?: string | null;
  newPerDay?: number;
  reviewLimit?: number;
  easeStart?: number;
  leechThreshold?: number;
  reminderHour?: number | null;
};

export class FlashcardSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlashcardSettingsValidationError';
  }
}

function validatePatch(patch: FlashcardSettingsPatch): void {
  if (patch.newPerDay !== undefined && patch.newPerDay < 0) {
    throw new FlashcardSettingsValidationError('newPerDay must be ≥ 0');
  }
  if (patch.reviewLimit !== undefined && patch.reviewLimit < 0) {
    throw new FlashcardSettingsValidationError('reviewLimit must be ≥ 0');
  }
  if (patch.easeStart !== undefined && patch.easeStart < 1.3) {
    throw new FlashcardSettingsValidationError('easeStart must be ≥ 1.3');
  }
  if (patch.leechThreshold !== undefined && patch.leechThreshold < 1) {
    throw new FlashcardSettingsValidationError('leechThreshold must be ≥ 1');
  }
  if (
    patch.reminderHour !== undefined &&
    patch.reminderHour !== null &&
    (patch.reminderHour < 0 || patch.reminderHour > 23 || !Number.isInteger(patch.reminderHour))
  ) {
    throw new FlashcardSettingsValidationError('reminderHour must be 0–23 or null');
  }
}

/**
 * Insert or update workspace flashcard settings. The patch is merged with
 * existing values (or defaults for new rows). Range violations throw
 * `FlashcardSettingsValidationError`.
 *
 * Returns the persisted row.
 */
export async function upsertWorkspaceFlashcardSettings(
  db: Db,
  workspaceId: string,
  patch: FlashcardSettingsPatch,
): Promise<WorkspaceFlashcardSettingsRow> {
  validatePatch(patch);

  // Build insert values: defaults merged with patch.
  const now = new Date();
  const insertValues: typeof schema.workspaceFlashcardSettings.$inferInsert = {
    workspaceId,
    defaultDeckId:
      patch.defaultDeckId !== undefined
        ? patch.defaultDeckId
        : DEFAULT_FLASHCARD_SETTINGS.defaultDeckId,
    newPerDay:
      patch.newPerDay !== undefined ? patch.newPerDay : DEFAULT_FLASHCARD_SETTINGS.newPerDay,
    reviewLimit:
      patch.reviewLimit !== undefined ? patch.reviewLimit : DEFAULT_FLASHCARD_SETTINGS.reviewLimit,
    easeStart:
      patch.easeStart !== undefined ? patch.easeStart : DEFAULT_FLASHCARD_SETTINGS.easeStart,
    leechThreshold:
      patch.leechThreshold !== undefined
        ? patch.leechThreshold
        : DEFAULT_FLASHCARD_SETTINGS.leechThreshold,
    reminderHour:
      patch.reminderHour !== undefined
        ? patch.reminderHour
        : DEFAULT_FLASHCARD_SETTINGS.reminderHour,
    createdAt: now,
    updatedAt: now,
  };

  // Build set values for conflict update (only patch fields + updatedAt).
  type SettingsSet = Partial<
    Omit<typeof schema.workspaceFlashcardSettings.$inferInsert, 'workspaceId' | 'createdAt'>
  >;
  const setValues: SettingsSet = { updatedAt: now };
  if (patch.defaultDeckId !== undefined) setValues.defaultDeckId = patch.defaultDeckId;
  if (patch.newPerDay !== undefined) setValues.newPerDay = patch.newPerDay;
  if (patch.reviewLimit !== undefined) setValues.reviewLimit = patch.reviewLimit;
  if (patch.easeStart !== undefined) setValues.easeStart = patch.easeStart;
  if (patch.leechThreshold !== undefined) setValues.leechThreshold = patch.leechThreshold;
  if (patch.reminderHour !== undefined) setValues.reminderHour = patch.reminderHour;

  const [row] = await (db as PostgresJsDatabase<typeof schema>)
    .insert(schema.workspaceFlashcardSettings)
    .values(insertValues)
    .onConflictDoUpdate({
      target: schema.workspaceFlashcardSettings.workspaceId,
      set: setValues,
    })
    .returning();

  if (!row) throw new Error('upsertWorkspaceFlashcardSettings: insert returned no row');
  return row;
}
