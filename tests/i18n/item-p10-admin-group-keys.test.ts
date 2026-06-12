import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.2 P10 — the settings Admin nav's six collapsible sub-group labels
// must exist in all three locale catalogs (the es-bundle test additionally
// enforces es⊆en⊇es).
const KEYS = [
  'settings.nav.admin.group.identity',
  'settings.nav.admin.group.audit',
  'settings.nav.admin.group.integrations',
  'settings.nav.admin.group.quotas',
  'settings.nav.admin.group.operations',
  'settings.nav.admin.group.billing',
] as const;

describe('P10 admin nav sub-group i18n keys', () => {
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

  it('en labels match the locked bucket map', () => {
    const m = en as Record<string, string>;
    expect(m['settings.nav.admin.group.identity']).toBe('Identity');
    expect(m['settings.nav.admin.group.audit']).toBe('Audit & Compliance');
    expect(m['settings.nav.admin.group.integrations']).toBe('Integrations');
    expect(m['settings.nav.admin.group.quotas']).toBe('Quotas');
    expect(m['settings.nav.admin.group.operations']).toBe('Operations');
    expect(m['settings.nav.admin.group.billing']).toBe('Billing');
  });
});
