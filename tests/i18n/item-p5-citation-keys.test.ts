import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

// v0.10.2 P5 — citation chip strings: the Add-citation affordance label and
// the chip trigger's aria-label ("Citation {number}").
const KEYS = ['editor.citation.addLabel', 'editor.citation.refLabel'] as const;

describe('P5 citation chip i18n parity', () => {
  for (const key of KEYS) {
    it(`present + non-empty in en/es/ar: ${key}`, () => {
      for (const [name, msgs] of [
        ['en', en],
        ['es', es],
        ['ar', ar],
      ] as const) {
        const v = (msgs as Record<string, string>)[key];
        expect(v, `${key} missing in ${name}`).toBeTruthy();
        expect(typeof v).toBe('string');
      }
    });
  }

  it('refLabel interpolates {number} in every locale', () => {
    for (const msgs of [en, es, ar]) {
      expect((msgs as Record<string, string>)['editor.citation.refLabel']).toContain('{number}');
    }
  });
});
