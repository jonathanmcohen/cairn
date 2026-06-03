import { afterEach, expect, it } from 'vitest';
import { __resetRegistered, ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import { matchShortcut, resetRegistry } from '@/lib/shortcuts/registry';

afterEach(() => {
  resetRegistry();
  __resetRegistered();
});

it('registers Mod+Shift+E → export.page in global scope (#61/#240)', () => {
  ensureAppShortcuts();
  const hit = matchShortcut(
    { key: 'e', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
    'global',
  );
  expect(hit?.id).toBe('export.page');
  expect(hit?.labelKey).toBe('shortcut.export');
});
