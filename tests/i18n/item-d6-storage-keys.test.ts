import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 D6 — storage usage meter + quota admin strings must exist in all
// three locale catalogs (the es-bundle test additionally enforces es⊆en⊇es).
const KEYS = [
  'settings.nav.admin.storage',
  'storage.usage.title',
  'storage.usage.loading',
  'storage.usage.error',
  'storage.usage.usedOfLimit',
  'storage.usage.usedUnlimited',
  'storage.usage.unlimited',
  'storage.usage.meterLabel',
  'storage.usage.remaining',
  'storage.usage.nearLimit',
  'admin.storage.title',
  'admin.storage.description',
  'admin.storage.limitHeading',
  'admin.storage.limitHint',
  'admin.storage.limitLabel',
  'admin.storage.unitMb',
  'admin.storage.unitGb',
  'admin.storage.setLimit',
  'admin.storage.clearLimit',
  'admin.storage.reconcileHeading',
  'admin.storage.reconcileHint',
  'admin.storage.reconcileNow',
  'admin.storage.noticeSaved',
  'admin.storage.noticeCleared',
  'admin.storage.noticeReconciled',
  'admin.storage.noticeInvalid',
  'admin.storage.noticeError',
] as const;

describe('D6 storage-quota i18n keys', () => {
  for (const cat of [
    ['en', en],
    ['es', es],
    ['ar', ar],
  ] as const) {
    const [name, messages] = cat;
    const m = messages as Record<string, string>;
    for (const k of KEYS) {
      it(`${name} has ${k}`, () => {
        const value = m[k];
        expect(typeof value).toBe('string');
        expect((value ?? '').length).toBeGreaterThan(0);
      });
    }
  }
});
