import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 D8 — semantic-index rebuild card strings (admin health page) must
// exist in all three locale catalogs (mirrors the D7 parity test).
const KEYS = [
  'admin.health.reindex.title',
  'admin.health.reindex.description',
  'admin.health.reindex.button',
  'admin.health.reindex.stateRunning',
  'admin.health.reindex.stateDone',
  'admin.health.reindex.stateError',
  'admin.health.reindex.neverRun',
  'admin.health.reindex.startedAtLabel',
  'admin.health.reindex.finishedAtLabel',
  'admin.health.reindex.phaseVectors',
  'admin.health.reindex.phaseIndex',
  'admin.health.reindex.vectorsSummary',
  'admin.health.reindex.startError',
] as const;

describe('D8 pgvector-reindex i18n keys', () => {
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

  it('vectorsSummary interpolates all four counters in every locale', () => {
    for (const m of [en, es, ar] as Record<string, string>[]) {
      const value = m['admin.health.reindex.vectorsSummary'] ?? '';
      for (const param of ['{processed}', '{embedded}', '{skipped}', '{errors}']) {
        expect(value).toContain(param);
      }
    }
  });
});
