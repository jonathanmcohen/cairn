import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 E2 — What's-new panel strings must exist in all three locale
// catalogs (mirrors the F1/F2/F3 parity tests).
const KEYS = [
  'whatsNew.title',
  'whatsNew.close',
  'whatsNew.fallback',
  'whatsNew.viewOnGitHub',
  'whatsNew.badge',
] as const;

describe('E2 whats-new i18n keys', () => {
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

  it('whatsNew.title interpolates {version} in every locale', () => {
    for (const m of [en, es, ar] as Record<string, string>[]) {
      expect(m['whatsNew.title']).toContain('{version}');
    }
  });
});
