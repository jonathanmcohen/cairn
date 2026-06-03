import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

const NEW_KEYS = [
  'pageActions.suggest.diffDeletedLabel',
  'pageActions.suggest.diffInsertedLabel',
  'pageActions.suggest.toggleSuggest',
  'pageActions.suggest.toggleSuggesting',
] as const;
const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('Plan S i18n keys (#232/#233)', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').length).toBeGreaterThan(0);
      });
    }
  }
});
