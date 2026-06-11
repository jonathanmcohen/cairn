import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 G5 — "Registration lock" card strings on the admin OAuth-clients
// page must exist in all three locale catalogs (mirrors the D6/D7/D8 parity
// tests). Keys live right after the D3 admin.oauthClients.* block.
const KEYS = [
  'admin.oauthClients.lock.title',
  'admin.oauthClients.lock.description',
  'admin.oauthClients.lock.stateOpen',
  'admin.oauthClients.lock.stateLocked',
  'admin.oauthClients.lock.enable',
  'admin.oauthClients.lock.disable',
  'admin.oauthClients.lock.regenerate',
  'admin.oauthClients.lock.tokenWarning',
  'admin.oauthClients.lock.copyToken',
  'admin.oauthClients.lock.error',
] as const;

describe('G5 registration-lock i18n keys', () => {
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
