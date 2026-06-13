import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import {
  DEFAULT_FLASHCARD_SETTINGS,
  FlashcardSettingsValidationError,
  getWorkspaceFlashcardSettings,
  upsertWorkspaceFlashcardSettings,
} from '@/lib/flashcards/settings';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE workspace_flashcard_settings, flashcard_reviews, flashcard_cards, flashcard_decks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

describe('getWorkspaceFlashcardSettings', () => {
  it('returns synthesized defaults when no row exists', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const settings = await getWorkspaceFlashcardSettings(getDb(), u.workspaceId);

    expect(settings.newPerDay).toBe(DEFAULT_FLASHCARD_SETTINGS.newPerDay);
    expect(settings.reviewLimit).toBe(DEFAULT_FLASHCARD_SETTINGS.reviewLimit);
    expect(settings.easeStart).toBe(DEFAULT_FLASHCARD_SETTINGS.easeStart);
    expect(settings.leechThreshold).toBe(DEFAULT_FLASHCARD_SETTINGS.leechThreshold);
    expect(settings.reminderHour).toBeNull();
    expect(settings.defaultDeckId).toBeNull();
  });

  it('returns persisted values when a row exists', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
      newPerDay: 10,
      reviewLimit: 50,
      easeStart: 2.0,
      leechThreshold: 4,
      reminderHour: 7,
    });

    const settings = await getWorkspaceFlashcardSettings(getDb(), u.workspaceId);
    expect(settings.newPerDay).toBe(10);
    expect(settings.reviewLimit).toBe(50);
    expect(settings.easeStart).toBeCloseTo(2.0);
    expect(settings.leechThreshold).toBe(4);
    expect(settings.reminderHour).toBe(7);
  });

  it('does not throw for a workspace with no settings row (non-existent workspace id still returns defaults)', async () => {
    // A random UUID that doesn't correspond to any workspace — settings lib
    // must return defaults without throwing.
    const fakeId = '00000000-0000-0000-0000-000000000099';
    const settings = await getWorkspaceFlashcardSettings(getDb(), fakeId);
    expect(settings.newPerDay).toBe(DEFAULT_FLASHCARD_SETTINGS.newPerDay);
  });
});

describe('upsertWorkspaceFlashcardSettings', () => {
  it('inserts a row on first call and returns it', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const row = await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
      newPerDay: 25,
      leechThreshold: 6,
    });

    expect(row.workspaceId).toBe(u.workspaceId);
    expect(row.newPerDay).toBe(25);
    expect(row.leechThreshold).toBe(6);
    // Unset fields pick up defaults.
    expect(row.reviewLimit).toBe(DEFAULT_FLASHCARD_SETTINGS.reviewLimit);
    expect(row.easeStart).toBeCloseTo(DEFAULT_FLASHCARD_SETTINGS.easeStart);
  });

  it('updates an existing row on second call (upsert)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { newPerDay: 5 });
    const row2 = await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { newPerDay: 99 });
    expect(row2.newPerDay).toBe(99);
    // Only one row should exist.
    const rows = await sql`
      SELECT * FROM workspace_flashcard_settings WHERE workspace_id = ${u.workspaceId}
    `;
    expect(rows).toHaveLength(1);
  });

  it('sets reminderHour to null', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { reminderHour: 8 });
    const row = await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
      reminderHour: null,
    });
    expect(row.reminderHour).toBeNull();
  });

  describe('range validation', () => {
    it('rejects newPerDay < 0', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      await expect(
        upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { newPerDay: -1 }),
      ).rejects.toThrow(FlashcardSettingsValidationError);
    });

    it('allows newPerDay = 0', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      const row = await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { newPerDay: 0 });
      expect(row.newPerDay).toBe(0);
    });

    it('rejects reviewLimit < 0', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      await expect(
        upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { reviewLimit: -5 }),
      ).rejects.toThrow(FlashcardSettingsValidationError);
    });

    it('rejects easeStart < 1.3', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      await expect(
        upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { easeStart: 1.2 }),
      ).rejects.toThrow(FlashcardSettingsValidationError);
    });

    it('allows easeStart = 1.3', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      const row = await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
        easeStart: 1.3,
      });
      expect(row.easeStart).toBeCloseTo(1.3);
    });

    it('rejects leechThreshold < 1', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      await expect(
        upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { leechThreshold: 0 }),
      ).rejects.toThrow(FlashcardSettingsValidationError);
    });

    it('rejects reminderHour < 0', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      await expect(
        upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { reminderHour: -1 }),
      ).rejects.toThrow(FlashcardSettingsValidationError);
    });

    it('rejects reminderHour > 23', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      await expect(
        upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, { reminderHour: 24 }),
      ).rejects.toThrow(FlashcardSettingsValidationError);
    });

    it('allows reminderHour = 0', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      const row = await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
        reminderHour: 0,
      });
      expect(row.reminderHour).toBe(0);
    });

    it('allows reminderHour = 23', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
      const row = await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
        reminderHour: 23,
      });
      expect(row.reminderHour).toBe(23);
    });
  });
});
