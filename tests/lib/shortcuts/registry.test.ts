import { afterEach, describe, expect, it } from 'vitest';
import {
  type KeyEventLike,
  matchShortcut,
  normalizeKeys,
  registerShortcut,
  resetRegistry,
} from '@/lib/shortcuts/registry';

afterEach(() => {
  resetRegistry();
});

describe('normalizeKeys', () => {
  it('lowercases parts and sorts modifiers into canonical order', () => {
    expect(normalizeKeys('Shift+Mod+N')).toBe('mod+shift+n');
  });
});

describe('registerShortcut conflict detection', () => {
  it('registers a shortcut', () => {
    registerShortcut({
      id: 'page.new',
      keys: 'Mod+N',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.newPage',
      run: () => {},
    });
    expect(true).toBe(true);
  });

  it('throws on same-scope same-keys collision', () => {
    registerShortcut({
      id: 'page.new',
      keys: 'Mod+N',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.newPage',
      run: () => {},
    });
    expect(() =>
      registerShortcut({
        id: 'other',
        keys: 'Mod+N',
        scope: 'global',
        kind: 'action',
        labelKey: 'shortcut.other',
        run: () => {},
      }),
    ).toThrow(/page\.new/);
  });

  it('treats modifier-order variants as conflicting', () => {
    registerShortcut({
      id: 'theme.toggle',
      keys: 'Mod+Shift+L',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.toggleTheme',
      run: () => {},
    });
    expect(() =>
      registerShortcut({
        id: 'other',
        keys: 'Shift+Mod+L',
        scope: 'global',
        kind: 'action',
        labelKey: 'shortcut.other',
        run: () => {},
      }),
    ).toThrow(/theme\.toggle/);
  });

  it('allows the same keys in a different scope', () => {
    registerShortcut({
      id: 'page.new',
      keys: 'Mod+N',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.newPage',
      run: () => {},
    });
    expect(() =>
      registerShortcut({
        id: 'editor.note',
        keys: 'Mod+N',
        scope: 'editor',
        kind: 'action',
        labelKey: 'shortcut.editorNote',
        run: () => {},
      }),
    ).not.toThrow();
  });

  it('is idempotent on same id (replaces, no throw)', () => {
    registerShortcut({
      id: 'page.new',
      keys: 'Mod+N',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.newPage',
      run: () => {},
    });
    expect(() =>
      registerShortcut({
        id: 'page.new',
        keys: 'Mod+N',
        scope: 'global',
        kind: 'action',
        labelKey: 'shortcut.newPage',
        run: () => {},
      }),
    ).not.toThrow();
  });
});

describe('matchShortcut', () => {
  it('matches metaKey+key against Mod+N', () => {
    registerShortcut({
      id: 'page.new',
      keys: 'Mod+N',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.newPage',
      run: () => {},
    });
    const e: KeyEventLike = {
      key: 'n',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchShortcut(e, 'global')?.id).toBe('page.new');
  });

  it('matches ctrlKey+key against Mod+N', () => {
    registerShortcut({
      id: 'page.new',
      keys: 'Mod+N',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.newPage',
      run: () => {},
    });
    const e: KeyEventLike = {
      key: 'n',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    };
    expect(matchShortcut(e, 'global')?.id).toBe('page.new');
  });

  it('requires Shift when shortcut includes Shift', () => {
    registerShortcut({
      id: 'theme.toggle',
      keys: 'Mod+Shift+L',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.toggleTheme',
      run: () => {},
    });
    const noShift: KeyEventLike = {
      key: 'l',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchShortcut(noShift, 'global')).toBeNull();
    const withShift: KeyEventLike = {
      key: 'l',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    };
    expect(matchShortcut(withShift, 'global')?.id).toBe('theme.toggle');
  });

  it('returns null on no match', () => {
    registerShortcut({
      id: 'page.new',
      keys: 'Mod+N',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.newPage',
      run: () => {},
    });
    const e: KeyEventLike = {
      key: 'x',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchShortcut(e, 'global')).toBeNull();
  });
});
