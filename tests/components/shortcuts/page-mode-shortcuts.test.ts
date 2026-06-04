// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetRegistered, ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import { getShortcuts, matchShortcut, resetRegistry } from '@/lib/shortcuts/registry';

// v0.9.9 Plan O #57/#236 — page focus/reader toggle shortcuts. The toggles live
// outside the dispatcher tree, so each registry `run` dispatches a window
// CustomEvent the <PageModeShell> listens for (same pattern as editor.insertLink).

beforeEach(() => {
  resetRegistry();
  __resetRegistered();
});

afterEach(() => {
  resetRegistry();
  __resetRegistered();
  vi.restoreAllMocks();
});

it('registers page.focus (Mod+Shift+.) + page.reader (Mod+Shift+R) in global scope', () => {
  ensureAppShortcuts();
  const focus = getShortcuts('global').find((s) => s.id === 'page.focus');
  const reader = getShortcuts('global').find((s) => s.id === 'page.reader');
  expect(focus?.keys).toBe('Mod+Shift+.');
  expect(focus?.scope).toBe('global');
  expect(focus?.labelKey).toBe('shortcut.focusMode');
  expect(reader?.keys).toBe('Mod+Shift+R');
  expect(reader?.scope).toBe('global');
  expect(reader?.labelKey).toBe('shortcut.readerMode');
});

it('matchShortcut resolves Mod+Shift+. to page.focus', () => {
  ensureAppShortcuts();
  const hit = matchShortcut(
    { key: '.', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
    'global',
  );
  expect(hit?.id).toBe('page.focus');
});

it('matchShortcut resolves Mod+Shift+R to page.reader', () => {
  ensureAppShortcuts();
  const hit = matchShortcut(
    { key: 'r', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
    'global',
  );
  expect(hit?.id).toBe('page.reader');
});

it('page.focus run() dispatches cairn:page-mode:toggle-focus', () => {
  ensureAppShortcuts();
  const spy = vi.spyOn(window, 'dispatchEvent');
  const focus = getShortcuts('global').find((s) => s.id === 'page.focus');
  focus?.run();
  expect(spy).toHaveBeenCalled();
  const evt = spy.mock.calls.at(-1)?.[0] as Event;
  expect(evt.type).toBe('cairn:page-mode:toggle-focus');
});

it('page.reader run() dispatches cairn:page-mode:toggle-reader', () => {
  ensureAppShortcuts();
  const spy = vi.spyOn(window, 'dispatchEvent');
  const reader = getShortcuts('global').find((s) => s.id === 'page.reader');
  reader?.run();
  expect(spy).toHaveBeenCalled();
  const evt = spy.mock.calls.at(-1)?.[0] as Event;
  expect(evt.type).toBe('cairn:page-mode:toggle-reader');
});
