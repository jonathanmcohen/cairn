import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { getThemePrefs, setThemePrefs } from '@/lib/themes/prefs';
import { DEFAULT_THEME_PREFS } from '@/lib/themes/presets';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE user_theme_prefs, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('user-theme-prefs roundtrip', () => {
  it('returns DEFAULT_THEME_PREFS when no row exists', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const prefs = await getThemePrefs(db, u.userId);
    expect(prefs).toEqual(DEFAULT_THEME_PREFS);
  });

  it('upserts on first set + returns the saved row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await setThemePrefs(db, u.userId, {
      accent: 'violet',
      fontFamily: 'serif',
      pageWidth: 'narrow',
    });
    const prefs = await getThemePrefs(db, u.userId);
    expect(prefs).toEqual({ accent: 'violet', fontFamily: 'serif', pageWidth: 'narrow' });
  });

  it('overwrites on a second set', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await setThemePrefs(db, u.userId, {
      accent: 'blue',
      fontFamily: 'system',
      pageWidth: 'wide',
    });
    await setThemePrefs(db, u.userId, {
      accent: '#abc123',
      fontFamily: 'mono',
      pageWidth: 'full',
    });
    const prefs = await getThemePrefs(db, u.userId);
    expect(prefs.accent).toBe('#abc123');
    expect(prefs.fontFamily).toBe('mono');
    expect(prefs.pageWidth).toBe('full');
  });

  it('isolates rows across users', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    await setThemePrefs(db, a.userId, {
      accent: 'rose',
      fontFamily: 'serif',
      pageWidth: 'narrow',
    });
    expect(await getThemePrefs(db, b.userId)).toEqual(DEFAULT_THEME_PREFS);
  });
});
