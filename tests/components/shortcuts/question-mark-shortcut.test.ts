// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRegistered,
  ensureAppShortcuts,
  type ShortcutHandlers,
  setShortcutHandlers,
} from '@/components/shortcuts/app-shortcuts';
import { handleShortcutKeydown, isEditableTarget } from '@/components/shortcuts/dispatcher';
import { getShortcuts, normalizeKeys, resetRegistry } from '@/lib/shortcuts/registry';

// v0.10.0 Plan E E1 — bare `?` opens the keyboard-shortcuts cheat sheet.
// The dispatcher historically early-returned on every keydown without a
// modifier; it now allow-lists `?` (keyed off the layout value e.key, never
// the physical Shift+/ code) when focus is outside editable controls.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));

function makeHandlers(): ShortcutHandlers {
  return {
    newPage: vi.fn(),
    toggleTheme: vi.fn(),
    switchWorkspace: vi.fn(),
    openFavorites: vi.fn(),
    openSheet: vi.fn(),
    export: vi.fn(),
  };
}

let handlers: ShortcutHandlers;

beforeEach(() => {
  resetRegistry();
  __resetRegistered();
  ensureAppShortcuts();
  handlers = makeHandlers();
  setShortcutHandlers(handlers);
  window.addEventListener('keydown', handleShortcutKeydown);
});

afterEach(() => {
  window.removeEventListener('keydown', handleShortcutKeydown);
  resetRegistry();
  __resetRegistered();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Dispatch a bubbling keydown on `el` so handleShortcutKeydown sees it as
 *  e.target — the same shape the real window listener receives. */
function press(el: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

describe('E1 — bare ? opens the shortcuts sheet', () => {
  it('fires the sheet action on bare ? with body focus (US-layout Shift+/ event shape)', () => {
    const e = press(document.body, { key: '?', shiftKey: true });
    expect(handlers.openSheet).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('fires on ? without Shift too (layouts where ? is an unshifted key)', () => {
    press(document.body, { key: '?', shiftKey: false });
    expect(handlers.openSheet).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when an <input> has focus — the character must land in the field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const e = press(input, { key: '?', shiftKey: true });
    expect(handlers.openSheet).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('does NOT fire inside a contenteditable (the TipTap editor surface)', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const para = document.createElement('p');
    editor.appendChild(para);
    document.body.appendChild(editor);
    const e = press(para, { key: '?', shiftKey: true });
    expect(handlers.openSheet).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores every other bare key (no floodgates: "a" with body focus stays a no-op)', () => {
    const e = press(document.body, { key: 'a' });
    expect(handlers.openSheet).not.toHaveBeenCalled();
    expect(handlers.newPage).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores Alt+? (a modifier combo is not the bare-key gesture)', () => {
    press(document.body, { key: '?', altKey: true });
    expect(handlers.openSheet).not.toHaveBeenCalled();
  });

  it('Mod+/ still opens the sheet', () => {
    const e = press(document.body, { key: '/', metaKey: true });
    expect(handlers.openSheet).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("'?' and 'Mod+/' are distinct registry entries with the same label", () => {
    const global = getShortcuts('global');
    const modSlash = global.find((s) => s.id === 'shortcuts.sheet');
    const bare = global.find((s) => s.id === 'shortcuts.sheet.bare');
    expect(modSlash?.keys).toBe('Mod+/');
    expect(bare?.keys).toBe('?');
    expect(bare?.labelKey).toBe(modSlash?.labelKey);
    // normalizeKeys must keep them apart — registration would throw otherwise.
    expect(normalizeKeys('?')).not.toBe(normalizeKeys('Mod+/'));
  });
});

describe('isEditableTarget', () => {
  it('is false for body, true for input/textarea/combobox/contenteditable descendants', () => {
    document.body.innerHTML = [
      '<div id="plain"></div>',
      '<textarea id="ta"></textarea>',
      '<div id="combo" role="combobox"><span id="combo-child"></span></div>',
      '<div id="ce" contenteditable="true"><span id="ce-child"></span></div>',
    ].join('');
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(document.getElementById('plain'))).toBe(false);
    expect(isEditableTarget(document.getElementById('ta'))).toBe(true);
    expect(isEditableTarget(document.getElementById('combo-child'))).toBe(true);
    expect(isEditableTarget(document.getElementById('ce-child'))).toBe(true);
  });

  it('falls back to document.activeElement for non-Element targets', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isEditableTarget(null)).toBe(true);
    input.blur();
    expect(isEditableTarget(null)).toBe(false);
  });
});
