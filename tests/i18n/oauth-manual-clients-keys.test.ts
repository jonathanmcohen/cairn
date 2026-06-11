// Post-v0.10.0 — catalog parity for the manual OAuth client provisioning
// surface (/settings/admin/oauth-clients): the "Create client" card, the
// show-once credentials panel, and the per-row "Rotate secret" action. Every
// key must exist non-empty in en/es/ar (CI bans hardcoded JSX strings, so a
// missing catalog entry would render the raw key).
import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

const NEW_KEYS = [
  'admin.oauthClients.create.title',
  'admin.oauthClients.create.description',
  'admin.oauthClients.create.nameLabel',
  'admin.oauthClients.create.namePlaceholder',
  'admin.oauthClients.create.urisLabel',
  'admin.oauthClients.create.urisPlaceholder',
  'admin.oauthClients.create.urisHint',
  'admin.oauthClients.create.typeLabel',
  'admin.oauthClients.create.typeConfidential',
  'admin.oauthClients.create.typePublic',
  'admin.oauthClients.create.submit',
  'admin.oauthClients.create.invalid',
  'admin.oauthClients.showOnce.note',
  'admin.oauthClients.showOnce.publicNote',
  'admin.oauthClients.showOnce.secretLabel',
  'admin.oauthClients.showOnce.copySecret',
  'admin.oauthClients.rotate',
  'admin.oauthClients.rotateConfirmTitle',
  'admin.oauthClients.rotateConfirmBody',
  'admin.oauthClients.rotateConfirm',
  'admin.oauthClients.rotateCancel',
  'admin.oauthClients.rotated.note',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('manual OAuth client provisioning i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').length).toBeGreaterThan(0);
      });
    }
  }

  it('the rotate confirm body interpolates the client name in every catalog', () => {
    for (const messages of Object.values(catalogs)) {
      expect(messages['admin.oauthClients.rotateConfirmBody']).toContain('{name}');
    }
  });
});
