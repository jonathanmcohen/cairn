import { describe, expect, it } from 'vitest';
import { type ActionKind, isActionAllowedOffline } from '@/components/pwa/offline-gate';

const NON_YJS: ActionKind[] = [
  'page-create',
  'page-move',
  'page-delete',
  'page-restore',
  'db-row-mutate',
  'file-upload',
  'comment',
  'share',
  'admin',
];

describe('isActionAllowedOffline — bounded-offline contract', () => {
  it('allows a yjs-edit on an already-loaded doc while offline', () => {
    expect(isActionAllowedOffline('yjs-edit', { online: false })).toBe(true);
  });

  it('blocks every non-Yjs action while offline', () => {
    for (const action of NON_YJS) {
      expect(isActionAllowedOffline(action, { online: false })).toBe(false);
    }
  });

  it('allows everything while online', () => {
    expect(isActionAllowedOffline('yjs-edit', { online: true })).toBe(true);
    for (const action of NON_YJS) {
      expect(isActionAllowedOffline(action, { online: true })).toBe(true);
    }
  });
});
