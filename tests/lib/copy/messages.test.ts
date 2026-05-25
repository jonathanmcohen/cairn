import { describe, expect, it } from 'vitest';
import { copy, hasCopy, listCopyKeys } from '@/lib/copy/messages';

describe('copy() registry', () => {
  it('returns the string for a known key', () => {
    expect(copy('empty.pageTree.headline')).toBe('No pages yet');
  });

  it('throws on a missing key', () => {
    expect(() => copy('does.not.exist' as never)).toThrow(/copy key not found/i);
  });

  it('hasCopy returns true/false without throwing', () => {
    expect(hasCopy('empty.pageTree.headline')).toBe(true);
    expect(hasCopy('does.not.exist')).toBe(false);
  });

  it('exposes every empty-state variant headline + guidance', () => {
    for (const variant of [
      'pageTree',
      'search',
      'dbTable',
      'notifications',
      'favorites',
      'inbox',
      'backlinks',
      'recents',
    ]) {
      expect(hasCopy(`empty.${variant}.headline`)).toBe(true);
      expect(hasCopy(`empty.${variant}.guidance`)).toBe(true);
    }
  });

  it('exposes microcopy keys for the v0.8 audited surfaces', () => {
    for (const key of [
      'wizard.welcome.headline',
      'wizard.welcome.cta',
      'wizard.name.headline',
      'wizard.name.cta',
      'wizard.pick.headline',
      'wizard.pick.ctaPrimary',
      'wizard.pick.ctaSecondary',
      'quickCapture.cta',
      'quickCapture.cancel',
      'inboxTriage.markDone',
      'palette.recentHeading',
    ]) {
      expect(hasCopy(key)).toBe(true);
    }
  });

  it('listCopyKeys returns at least 30 keys (sanity-check the registry is non-trivial)', () => {
    expect(listCopyKeys().length).toBeGreaterThanOrEqual(30);
  });
});
