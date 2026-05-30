// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prettyKeys, shortcutFor } from '@/lib/shortcuts/format';
import { registerShortcut, resetRegistry } from '@/lib/shortcuts/registry';

afterEach(() => {
  resetRegistry();
  vi.unstubAllGlobals();
});

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform });
}

describe('prettyKeys', () => {
  it('renders macOS glyphs with no separator', () => {
    stubPlatform('MacIntel');
    expect(prettyKeys('Mod+Shift+F')).toBe('⌘⇧F');
  });

  it('renders win/linux labels joined by +', () => {
    stubPlatform('Win32');
    expect(prettyKeys('Mod+Shift+F')).toBe('Ctrl+Shift+F');
  });
});

describe('shortcutFor', () => {
  it('returns the registered keys for a known id, undefined otherwise', () => {
    registerShortcut({
      id: 'nav.favorites',
      keys: 'Mod+Shift+F',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.openFavorites',
      run: () => {},
    });
    expect(shortcutFor('nav.favorites')).toBe('Mod+Shift+F');
    expect(shortcutFor('does.not.exist')).toBeUndefined();
  });
});
