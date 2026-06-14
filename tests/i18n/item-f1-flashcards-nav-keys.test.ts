import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

// v0.10.2 F1 Task D — the consolidated Flashcards sidebar nav (parent label +
// chevron toggle aria-label + "Due now" child + pluralized due-count aria
// label). The Manage / Orphans child labels reuse existing flashcards.* keys
// (asserted below) rather than minting duplicates.
const NEW_KEYS = [
  'sidebar.nav.flashcards',
  'sidebar.nav.flashcards.toggle',
  'sidebar.nav.flashcards.due',
  'sidebar.nav.flashcards.dueCount.one',
  'sidebar.nav.flashcards.dueCount.other',
] as const;

// Reused from Tasks B/C — the nav children point at these instead of new keys.
const REUSED_KEYS = ['flashcards.manage.nav', 'flashcards.overview.nav.orphans'] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('item F1 Task D — flashcards sidebar nav i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of [...NEW_KEYS, ...REUSED_KEYS]) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }

  // The plural `.other` form must interpolate the numeral so the badge's
  // sr-only twin reads the count to screen readers (the `.one` form may be a
  // bare noun where the language doesn't repeat the numeral, e.g. Arabic).
  for (const [locale, messages] of Object.entries(catalogs)) {
    it(`${locale} dueCount.other carries the {count} placeholder`, () => {
      expect(messages['sidebar.nav.flashcards.dueCount.other']).toContain('{count}');
    });
  }
});
