import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import {
  DEFAULT_THEME_PREFS,
  type FontFamily,
  type PageWidth,
  type ThemePrefs,
  ThemePrefsSchema,
} from './presets';

/**
 * Load a user's theme prefs. Falls back to DEFAULT_THEME_PREFS when no row
 * exists so the first render never blocks on a write.
 */
export async function getThemePrefs(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<ThemePrefs> {
  const [row] = await db
    .select()
    .from(schema.userThemePrefs)
    .where(eq(schema.userThemePrefs.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_THEME_PREFS;
  return {
    accent: row.accent,
    fontFamily: row.fontFamily as FontFamily,
    pageWidth: row.pageWidth as PageWidth,
  };
}

/**
 * Upsert a user's theme prefs. Throws on invalid inputs (caller is the API
 * route; the route's Zod parse runs first, so this throw is defense-in-depth).
 */
export async function setThemePrefs(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  prefs: ThemePrefs,
): Promise<void> {
  const parsed = ThemePrefsSchema.parse(prefs);
  await db
    .insert(schema.userThemePrefs)
    .values({
      userId,
      accent: parsed.accent,
      fontFamily: parsed.fontFamily,
      pageWidth: parsed.pageWidth,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.userThemePrefs.userId,
      set: {
        accent: parsed.accent,
        fontFamily: parsed.fontFamily,
        pageWidth: parsed.pageWidth,
        updatedAt: new Date(),
      },
    });
}
