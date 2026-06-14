import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

// v0.10.2 F3 Task C — the .apkg (Anki) export button label. One new key; must
// exist (non-empty) in all three locales for parity.
const NEW_KEYS = ['flashcards.manage.exportApkg'] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('item F3 Task C — .apkg export i18n key', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }
});
