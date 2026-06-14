import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

/**
 * v0.10.2 F3 Task D — flashcard workspace settings surface.
 * Every user-facing string flows through useT(); these keys must exist
 * (non-empty) in all three locales.
 */
const NEW_KEYS = [
  'settings.nav.workspace.flashcards',
  'flashcards.settings.title',
  'flashcards.settings.description',
  'flashcards.settings.defaultDeck.label',
  'flashcards.settings.defaultDeck.hint',
  'flashcards.settings.defaultDeck.none',
  'flashcards.settings.newPerDay.label',
  'flashcards.settings.newPerDay.hint',
  'flashcards.settings.reviewLimit.label',
  'flashcards.settings.reviewLimit.hint',
  'flashcards.settings.easeStart.label',
  'flashcards.settings.easeStart.hint',
  'flashcards.settings.leechThreshold.label',
  'flashcards.settings.leechThreshold.hint',
  'flashcards.settings.reminderHour.label',
  'flashcards.settings.reminderHour.hint',
  'flashcards.settings.reminderHour.smtpOff',
  'flashcards.settings.reminderHour.none',
  'flashcards.settings.save',
  'flashcards.settings.saved',
  'flashcards.settings.saveError',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('item F3 Task D — flashcard settings i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }
});
