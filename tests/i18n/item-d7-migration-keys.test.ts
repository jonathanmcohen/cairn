import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 D7 — migration status panel strings must exist in all three locale
// catalogs (the es-bundle test additionally enforces es⊆en⊇es).
const KEYS = [
  'settings.nav.admin.migrations',
  'admin.migrations.title',
  'admin.migrations.description',
  'admin.migrations.refresh',
  'admin.migrations.currentVersionLabel',
  'admin.migrations.currentVersionNone',
  'admin.migrations.appliedOfTotal',
  'admin.migrations.stateOk',
  'admin.migrations.statePending',
  'admin.migrations.stateDrift',
  'admin.migrations.appliedHeading',
  'admin.migrations.appliedEmpty',
  'admin.migrations.appliedAtUnknown',
  'admin.migrations.showAll',
  'admin.migrations.showRecent',
  'admin.migrations.pendingHeading',
  'admin.migrations.pendingRecovery',
  'admin.migrations.driftHeading',
  'admin.migrations.driftRecovery',
  'admin.migrations.journalMissing',
  'admin.migrations.readOnlyNote',
  'admin.migrations.docsLink',
] as const;

describe('D7 migration-status i18n keys', () => {
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
