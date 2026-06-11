import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 F1 — workspace brand (logo + primary color) strings must exist in
// all three locale catalogs (mirrors the d6/d7/d8 parity tests).
const KEYS = [
  'workspaceSettings.brand.title',
  'workspaceSettings.brand.description',
  'workspaceSettings.brand.logoLabel',
  'workspaceSettings.brand.logoHint',
  'workspaceSettings.brand.logoAlt',
  'workspaceSettings.brand.uploadLogo',
  'workspaceSettings.brand.removeLogo',
  'workspaceSettings.brand.colorLabel',
  'workspaceSettings.brand.colorHint',
  'workspaceSettings.brand.hexLabel',
  'workspaceSettings.brand.clearColor',
  'workspaceSettings.brand.contrastAdjusted',
  'workspaceSettings.brand.invalidHex',
  'workspaceSettings.brand.save',
  'workspaceSettings.brand.saved',
  'workspaceSettings.brand.uploadError',
] as const;

describe('F1 workspace-brand i18n keys', () => {
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
