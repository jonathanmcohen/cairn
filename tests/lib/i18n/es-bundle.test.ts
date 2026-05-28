import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json' with { type: 'json' };
import es from '../../../messages/es.json' with { type: 'json' };

describe('messages/es.json', () => {
  it('covers every key in en.json', () => {
    const missing = Object.keys(en).filter((k) => !(k in es));
    expect(missing).toEqual([]);
  });

  it('has no extra keys not present in en.json', () => {
    const extra = Object.keys(es).filter((k) => !(k in en));
    expect(extra).toEqual([]);
  });

  it('every value is a non-empty string', () => {
    for (const [k, v] of Object.entries(es)) {
      expect(typeof v, `value for ${k}`).toBe('string');
      expect((v as string).trim().length, `value for ${k}`).toBeGreaterThan(0);
    }
  });

  it('preserves brand name Cairn untranslated where en uses it', () => {
    if (typeof (en as Record<string, string>)['app.title'] === 'string') {
      expect((es as Record<string, string>)['app.title']).toBe('Cairn');
    }
  });
});
