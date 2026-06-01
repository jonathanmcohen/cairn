import { describe, expect, it } from 'vitest';
import ar from '@/../messages/ar.json';
import en from '@/../messages/en.json';
import es from '@/../messages/es.json';

const KEYS = [
  'e2e.enroll.title',
  'e2e.enroll.description',
  'e2e.enroll.cta',
  'e2e.enroll.passphrasePrompt',
  'e2e.enroll.confirmPrompt',
  'e2e.enroll.mismatch',
  'e2e.enroll.success',
  'e2e.enroll.busy',
  'e2e.enroll.alreadyEnrolled',
  'e2e.enroll.recoveryNeeded',
  'e2e.enroll.warning',
  'e2e.enroll.cancelled',
  'e2e.enroll.disabledBuild',
  // Per-page Encrypt action (Task 6).
  'e2e.encryptPage.cta',
  'e2e.encryptPage.busy',
  'e2e.encryptPage.passphrasePrompt',
  'e2e.encryptPage.noRoster',
  'e2e.encryptPage.keyMismatch',
  'e2e.encryptPage.failed',
  // Workspace-wide toggle (Task 7).
  'e2e.workspaceToggle.cta',
  'e2e.workspaceToggle.busy',
  'e2e.workspaceToggle.passphrasePrompt',
  'e2e.workspaceToggle.noRoster',
  'e2e.workspaceToggle.keyMismatch',
  'e2e.workspaceToggle.enabled',
  'e2e.workspaceToggle.enabledHint',
  'e2e.workspaceToggle.progress',
  'e2e.workspaceToggle.warning',
  // Rekey (Task 10).
  'e2e.rekey.title',
  'e2e.rekey.description',
  'e2e.rekey.removeMember',
  'e2e.rekey.rotateOnly',
  'e2e.rekey.confirmTitle',
  'e2e.rekey.confirmBody',
  'e2e.rekey.cta',
  'e2e.rekey.busy',
  'e2e.rekey.progress',
  'e2e.rekey.success',
  'e2e.rekey.error',
  'e2e.rekey.noKeypairWarning',
  'e2e.rekey.loadFailed',
] as const;

describe('G21 i18n keys', () => {
  for (const [name, cat] of [
    ['en', en],
    ['es', es],
    ['ar', ar],
  ] as Array<[string, Record<string, string>]>) {
    it(`${name} defines every G21 key with a non-empty value`, () => {
      for (const k of KEYS) {
        expect(Object.hasOwn(cat, k), `${name} missing ${k}`).toBe(true);
        expect(typeof cat[k]).toBe('string');
        expect((cat[k] as string).length).toBeGreaterThan(0);
      }
    });
  }
});
