// v0.10.0 H4 (polish batch) — catalog parity for the keys the batch added:
//  - H4a: OIDC IdP form scopes field label/hint
//  - H4c: settings-nav Developer "Workspace import" entry
//  - H4e: ⌘/ sheet quick-capture row (was the raw 'shortcuts.quickCapture'
//         string — the labelKey now points at 'shortcut.quickCapture', keyed
//         in every catalog)
import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

const NEW_KEYS = [
  'sso.oidc.scopes.label',
  'sso.oidc.scopes.hint',
  'settings.nav.developer.import',
  'shortcut.quickCapture',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('item H4 i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').length).toBeGreaterThan(0);
      });
    }
  }

  it('en renders the H4e quick-capture row as "Quick capture"', () => {
    expect(catalogs.en?.['shortcut.quickCapture']).toBe('Quick capture');
  });

  it('the stale shortcuts.quickCapture labelKey stays unkeyed (lookup was fixed, not the catalog)', () => {
    for (const messages of Object.values(catalogs)) {
      expect(messages['shortcuts.quickCapture']).toBeUndefined();
    }
  });
});
