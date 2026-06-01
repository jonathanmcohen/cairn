import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

const KEYS = [
  'search.mode.label',
  'search.mode.fts',
  'search.mode.semantic',
  'search.mode.hybrid',
  'search.mode.hint',
  'search.federated.toggle',
  'search.federated.hint',
  'search.page.title',
  'search.page.placeholder',
  'search.page.submit',
  'search.page.empty.headline',
  'search.page.empty.guidance',
  'search.page.peerHeading',
  'search.page.localHeading',
] as const;

describe('G17 search-reachability i18n keys (#164)', () => {
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
