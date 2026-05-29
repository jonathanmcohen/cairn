// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EditorLinkShortcut } from '@/components/editor/editor-link-shortcut';

describe('EditorLinkShortcut', () => {
  it('registers Mod-Shift-k and a selection-gated Mod-k', () => {
    const ext = EditorLinkShortcut;
    expect(ext.name).toBe('cairnLinkShortcut');
    const shortcuts = ext.config.addKeyboardShortcuts?.call({
      editor: { state: { selection: { empty: true } } },
    } as never);
    expect(shortcuts).toHaveProperty('Mod-Shift-k');
    expect(shortcuts).toHaveProperty('Mod-k');
  });

  it('Mod-k returns false (lets palette through) when selection is empty', () => {
    const dispatch = vi.fn();
    const handlers = EditorLinkShortcut.config.addKeyboardShortcuts?.call({
      editor: { state: { selection: { empty: true } } },
    } as never);
    // @ts-expect-error test-only narrow
    expect(handlers['Mod-k']()).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
