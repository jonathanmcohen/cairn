// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';
import { createT } from '@/lib/i18n/t';

// Mirrors the authority branch the LockBanner will compute.
function authorityKey(
  canUnlock: boolean,
): 'lock.banner.youCanUnlock' | 'lock.banner.adminCanUnlock' {
  return canUnlock ? 'lock.banner.youCanUnlock' : 'lock.banner.adminCanUnlock';
}

describe('lock banner authority strings (finding K)', () => {
  it('defines the three new keys in every locale', () => {
    for (const locale of ['en', 'es', 'ar'] as const) {
      const t = createT(locale, getMessages(locale));
      expect(t('lock.banner.lockedBy', { name: 'Ada' })).not.toBe('lock.banner.lockedBy');
      expect(t('lock.banner.youCanUnlock')).not.toBe('lock.banner.youCanUnlock');
      expect(t('lock.banner.adminCanUnlock', { name: 'Ada' })).not.toBe(
        'lock.banner.adminCanUnlock',
      );
    }
  });

  it('interpolates the locker name into the "locked by" + admin strings', () => {
    const t = createT('en', getMessages('en'));
    expect(t('lock.banner.lockedBy', { name: 'Ada' })).toContain('Ada');
    expect(t('lock.banner.adminCanUnlock', { name: 'Ada' })).toContain('Ada');
  });

  it('routes the authority branch by canUnlock', () => {
    expect(authorityKey(true)).toBe('lock.banner.youCanUnlock');
    expect(authorityKey(false)).toBe('lock.banner.adminCanUnlock');
  });
});
