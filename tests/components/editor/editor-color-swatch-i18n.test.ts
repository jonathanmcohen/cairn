import { describe, expect, it } from 'vitest';
import ar from '@/../messages/ar.json' with { type: 'json' };
import en from '@/../messages/en.json' with { type: 'json' };
import es from '@/../messages/es.json' with { type: 'json' };

const NEW_KEYS = [
  'editor.color.swatch.red',
  'editor.color.swatch.orange',
  'editor.color.swatch.yellow',
  'editor.color.swatch.green',
  'editor.color.swatch.blue',
  'editor.color.swatch.purple',
  'editor.color.removeText',
  'editor.color.removeHighlight',
] as const;

describe('#127 swatch popover i18n keys', () => {
  for (const locale of [
    ['en', en],
    ['es', es],
    ['ar', ar],
  ] as const) {
    const [name, messages] = locale;
    it(`${name} defines every swatch key with non-empty copy`, () => {
      for (const key of NEW_KEYS) {
        const value = (messages as Record<string, string>)[key];
        expect(value, `${name} missing ${key}`).toBeTruthy();
        expect(value!.trim().length).toBeGreaterThan(0);
      }
    });
  }
});
