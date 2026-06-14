// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { __resetRegistered, ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import {
  applySidebarCollapsedOnMount,
  SIDEBAR_COLLAPSED_CLASS,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  toggleSidebarCollapsed,
} from '@/components/sidebar-collapse';
import { getShortcuts, matchShortcut, resetRegistry } from '@/lib/shortcuts/registry';

// v0.10.2 S1 — Mod+\ toggles the `cairn-sidebar-collapsed` root class (56px
// icon rail in globals.css), persisted as '1'/'0' under
// `cairn:sidebar-collapsed`. The collapse must never touch the resize width
// (`cairn:sidebar-width` / --cairn-sidebar-w) so un-collapsing restores the
// user's prior custom width.

beforeEach(() => {
  resetRegistry();
  __resetRegistered();
});

afterEach(() => {
  resetRegistry();
  __resetRegistered();
  localStorage.clear();
  document.documentElement.classList.remove(SIDEBAR_COLLAPSED_CLASS);
});

it('registers sidebar.toggle (Mod+\\) in global scope with the i18n labelKey', () => {
  ensureAppShortcuts();
  const entry = getShortcuts('global').find((s) => s.id === 'sidebar.toggle');
  expect(entry?.keys).toBe('Mod+\\');
  expect(entry?.scope).toBe('global');
  expect(entry?.labelKey).toBe('shortcut.toggleSidebar');
});

it('matchShortcut resolves Mod+\\ to sidebar.toggle', () => {
  ensureAppShortcuts();
  const hit = matchShortcut(
    { key: '\\', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
    'global',
  );
  expect(hit?.id).toBe('sidebar.toggle');
});

it('sidebar.toggle run() flips the root class and persists the flag', () => {
  ensureAppShortcuts();
  const entry = getShortcuts('global').find((s) => s.id === 'sidebar.toggle');
  entry?.run();
  expect(document.documentElement.classList.contains(SIDEBAR_COLLAPSED_CLASS)).toBe(true);
  expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('1');
  entry?.run();
  expect(document.documentElement.classList.contains(SIDEBAR_COLLAPSED_CLASS)).toBe(false);
  expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('0');
});

it('collapsing never clobbers the persisted resize width', () => {
  localStorage.setItem('cairn:sidebar-width', '320');
  document.documentElement.style.setProperty('--cairn-sidebar-w', '320px');
  toggleSidebarCollapsed();
  toggleSidebarCollapsed();
  expect(localStorage.getItem('cairn:sidebar-width')).toBe('320');
  expect(document.documentElement.style.getPropertyValue('--cairn-sidebar-w')).toBe('320px');
});

it('applySidebarCollapsedOnMount restores the persisted collapsed state', () => {
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, '1');
  applySidebarCollapsedOnMount();
  expect(document.documentElement.classList.contains(SIDEBAR_COLLAPSED_CLASS)).toBe(true);
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, '0');
  applySidebarCollapsedOnMount();
  expect(document.documentElement.classList.contains(SIDEBAR_COLLAPSED_CLASS)).toBe(false);
});
