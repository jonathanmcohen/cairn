import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

const KEYS = ['editor.bibliography.toggle', 'editor.bibliography.toggleHint'] as const;

describe('G19 citation/bibliography i18n parity (#166)', () => {
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
});
