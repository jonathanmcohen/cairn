import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

const REQUIRED = [
  'connectorsDb.heading',
  'connectorsDb.subtitle',
  'connectorsDb.create',
  'connectorsDb.create.chooseDatabase',
  'connectorsDb.create.chooseKind',
  'connectorsDb.create.kind.google_sheets',
  'connectorsDb.create.kind.airtable',
  'connectorsDb.create.kind.csv',
  'connectorsDb.create.submit',
  'connectorsDb.create.cancel',
  'connectorsDb.create.error',
  'connectorsDb.empty',
  'connectorsDb.col.kind',
  'connectorsDb.col.database',
  'connectorsDb.col.lastSynced',
  'connectorsDb.col.status',
  'connectorsDb.status.enabled',
  'connectorsDb.status.disabled',
  'connectorsDb.neverSynced',
  'connectorsDb.configure',
  'connectorsDb.conflicts',
  'connectorsDb.delete',
  'connectorsDb.delete.confirmTitle',
  'connectorsDb.delete.confirmBody',
  'connectorsDb.delete.confirm',
  'connectorsDb.delete.cancel',
  'connectorsDb.config.heading',
  'connectorsDb.config.back',
  'connectorsDb.chatBridge.heading',
  'connectorsDb.chatBridge.link',
  'connectorsDb.chatBridge.channels',
];

describe('connectorsDb i18n keys present in all catalogs', () => {
  for (const key of REQUIRED) {
    it(`en has ${key}`, () => expect((en as Record<string, string>)[key]).toBeTruthy());
    it(`es has ${key}`, () => expect((es as Record<string, string>)[key]).toBeTruthy());
    it(`ar has ${key}`, () => expect((ar as Record<string, string>)[key]).toBeTruthy());
  }
});
