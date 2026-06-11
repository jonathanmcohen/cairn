import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 F3 — onboarding tour strings must exist in all three locale
// catalogs (mirrors the F1/F2 parity tests).
const KEYS = [
  'tour.replay',
  'tour.skip',
  'tour.back',
  'tour.next',
  'tour.done',
  'tour.progress',
  'tour.step.sidebar.title',
  'tour.step.sidebar.body',
  'tour.step.search.title',
  'tour.step.search.body',
  'tour.step.topbar.title',
  'tour.step.topbar.body',
  'tour.step.pageMenu.title',
  'tour.step.pageMenu.body',
  'tour.step.help.title',
  'tour.step.help.body',
] as const;

describe('F3 onboarding-tour i18n keys', () => {
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

  it('tour.progress interpolates {current} and {total} in every locale', () => {
    for (const m of [en, es, ar] as Record<string, string>[]) {
      expect(m['tour.progress']).toContain('{current}');
      expect(m['tour.progress']).toContain('{total}');
    }
  });
});
