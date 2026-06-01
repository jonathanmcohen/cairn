import { describe, expect, it } from 'vitest';
import arMessages from '../../../messages/ar.json' with { type: 'json' };
import enMessages from '../../../messages/en.json' with { type: 'json' };
import esMessages from '../../../messages/es.json' with { type: 'json' };

const G14_KEYS = [
  'settings.nav.admin.webhooks',
  'settings.nav.admin.mfa',
  'settings.nav.admin.encryption',
  'settings.nav.admin.upgrade',
  'settings.nav.admin.apiKeys',
  'settings.nav.admin.sso',
  'settings.nav.admin.chatBridge',
  'settings.nav.developer.automation',
  'settings.nav.developer.tokens',
  'settings.nav.developer.export',
  'settings.nav.developer.apiDocs',
  'settings.nav.developer.downloadOpenapi',
  'settings.nav.workspace.exportStatic',
  'settings.nav.workspace.trash',
  'settings.nav.workspace.pinnedPages',
  'settings.nav.account.theme',
  'search.page.title',
  'search.page.description',
  'search.page.empty',
  'search.page.resultsCount',
  'favorites.page.title',
  'favorites.page.description',
  'favorites.page.empty',
  'flashcards.study.link',
  'palette.quickCapture',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('G14 nav reachability i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of G14_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }
});
