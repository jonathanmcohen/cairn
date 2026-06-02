import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

const REQUIRED = [
  'settings.nav.admin.federated',
  'settings.nav.admin.users',
  'admin.federated.title',
  'admin.federated.description',
  'admin.federated.empty',
  'admin.federated.addPeer',
  'admin.federated.nameLabel',
  'admin.federated.baseUrlLabel',
  'admin.federated.secretLabel',
  'admin.federated.create',
  'admin.federated.creating',
  'admin.federated.enable',
  'admin.federated.disable',
  'admin.federated.remove',
  'admin.federated.statusEnabled',
  'admin.federated.statusDisabled',
  'admin.federated.error',
  'admin.users.title',
  'admin.users.description',
  'admin.users.invite',
] as const;

describe('G1 i18n keys exist in all locales', () => {
  for (const locale of [
    ['en', en],
    ['es', es],
    ['ar', ar],
  ] as const) {
    const [name, dict] = locale;
    it(`${name} has every G1 key and none is empty`, () => {
      for (const key of REQUIRED) {
        expect(Object.hasOwn(dict, key), `${name} missing ${key}`).toBe(true);
        expect((dict as Record<string, string>)[key]?.length ?? 0).toBeGreaterThan(0);
      }
    });
  }
});
