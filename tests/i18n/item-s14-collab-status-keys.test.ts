import { describe, expect, it } from 'vitest';
import arMessages from '../../messages/ar.json' with { type: 'json' };
import enMessages from '../../messages/en.json' with { type: 'json' };
import esMessages from '../../messages/es.json' with { type: 'json' };

// v0.10.2 S14 — the four collab connection-state labels, shared by the editor
// page-header pill and the sidebar-footer pill.
const NEW_KEYS = [
  'collab.status.connecting',
  'collab.status.connected',
  'collab.status.disconnected',
  'collab.status.error',
] as const;

const catalogs = { en: enMessages, es: esMessages, ar: arMessages } as Record<
  string,
  Record<string, string>
>;

describe('Item S14 collab.status.* i18n keys', () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of NEW_KEYS) {
      it(`${locale} has a non-empty value for ${key}`, () => {
        expect(typeof messages[key]).toBe('string');
        expect((messages[key] ?? '').length).toBeGreaterThan(0);
      });
    }
  }

  // Regression guard: the en pill text must stay byte-identical to the
  // previously-hardcoded STATUS_LABEL literals (existing e2e specs assert the
  // page-header pill via `getByTitle('Live')` / its visible text).
  it('en values are byte-identical to the original hardcoded labels', () => {
    const en = enMessages as Record<string, string>;
    expect(en['collab.status.connecting']).toBe('Connecting…');
    expect(en['collab.status.connected']).toBe('Live');
    expect(en['collab.status.disconnected']).toBe('Reconnecting…');
    expect(en['collab.status.error']).toBe('Offline');
  });
});
