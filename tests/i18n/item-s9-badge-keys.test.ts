import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

// v0.10.2 S9 — sr-only labels for the sidebar footer's inbox / my-tasks count
// pills. Plural pairs: createT() selects `.one`/`.other` from `{count}`.
const NEW_KEYS = [
  'sidebar.nav.inboxCount.one',
  'sidebar.nav.inboxCount.other',
  'sidebar.nav.myTasksCount.one',
  'sidebar.nav.myTasksCount.other',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('item S9 i18n keys (personal-hub badges)', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').length).toBeGreaterThan(0);
      });
    }
  }

  // The `.other` form interpolates the numeral — without {count} the sr-only
  // label would read as a bare noun and the badge number would be lost to
  // screen readers.
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of ['sidebar.nav.inboxCount.other', 'sidebar.nav.myTasksCount.other'] as const) {
      it(`${locale} ${key} carries the {count} placeholder`, () => {
        expect(messages[key]).toContain('{count}');
      });
    }
  }
});
