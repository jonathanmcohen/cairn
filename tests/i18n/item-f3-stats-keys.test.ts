import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

// v0.10.2 F3 Task B — flashcard stats surface. Every user-facing string flows
// through useT(); these keys must exist (non-empty) in all three locales.
const NEW_KEYS = [
  'flashcards.stats.nav',
  'flashcards.stats.title',
  'flashcards.stats.caveat',
  'flashcards.stats.empty',
  'flashcards.stats.dailyReviews.title',
  'flashcards.stats.retention.title',
  'flashcards.stats.retention.empty',
  'flashcards.stats.maturity.title',
  'flashcards.stats.maturity.new',
  'flashcards.stats.maturity.learning',
  'flashcards.stats.maturity.young',
  'flashcards.stats.maturity.mature',
  'flashcards.stats.heatmap.title',
  'flashcards.stats.perDeck.title',
  'flashcards.stats.perDeck.col.deck',
  'flashcards.stats.perDeck.col.reviews',
  'flashcards.stats.perDeck.col.retention',
  'flashcards.stats.perDeck.empty',
  'flashcards.stats.forecast.title',
  'flashcards.stats.forecast.next30',
] as const;

// Keys that carry interpolation placeholders.
const PLACEHOLDER_KEYS: Array<[string, string]> = [['flashcards.stats.forecast.next30', '{count}']];

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('item F3 Task B — flashcard stats i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }

  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const [key, token] of PLACEHOLDER_KEYS) {
      it(`${locale} ${key} keeps the ${token} placeholder`, () => {
        expect(messages[key]).toContain(token);
      });
    }
  }
});
