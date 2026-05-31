import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

const CATALOGS = { en, es, ar } as Record<string, Record<string, string>>;
const NEW_KEYS = [
  'database.view.disabled.calendar',
  'database.view.disabled.timeline',
  'database.empty.firstRow',
];

describe('G7 i18n keys (#142/#143/#144)', () => {
  for (const [locale, cat] of Object.entries(CATALOGS)) {
    for (const key of NEW_KEYS) {
      it(`${locale} defines ${key}`, () => {
        expect(typeof cat[key]).toBe('string');
        expect((cat[key] ?? '').length).toBeGreaterThan(0);
      });
    }
  }
});
