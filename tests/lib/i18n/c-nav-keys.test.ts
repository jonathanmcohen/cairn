import { describe, expect, it } from 'vitest';
import arMessages from '../../../messages/ar.json' with { type: 'json' };
import enMessages from '../../../messages/en.json' with { type: 'json' };
import esMessages from '../../../messages/es.json' with { type: 'json' };

const C_KEYS = [
  'sidebar.pages.heading',
  'sidebar.pages.collapseAll',
  'sidebar.pages.expandAll',
  'settings.nav.admin.chatBridge',
  'settings.nav.developer.chatBridge',
  'settings.nav.workspace.exportStatic',
  'settings.nav.developer.export',
  'workspace.export.heading',
  'workspace.export.subtitle',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('Plan C nav i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of C_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').trim().length).toBeGreaterThan(0);
      });
    }
  }
});
