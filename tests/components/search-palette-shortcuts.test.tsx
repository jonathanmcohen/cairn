// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// cmdk's <Command> uses ResizeObserver + scrollIntoView, which jsdom omits.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// Stub macOS so we assert on the glyph form.
vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: vi.fn() } });

// Stable references: returning a fresh object/fn per call would change the
// effect dep identities every render → infinite render loop → OOM.
const mocks = vi.hoisted(() => ({
  router: { push: () => {}, refresh: () => {} },
  theme: { theme: 'light', setTheme: () => {} },
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('next-themes', () => ({ useTheme: () => mocks.theme }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

afterEach(cleanup);

async function openPalette() {
  render(<SearchPalette currentUserId="u1" />);
  // The palette is hidden until ⌘K; dispatch it.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  // Let the effects (ensureAppShortcuts + buildPaletteActions) settle.
  await screen.findByText('palette.actions');
}

describe('SearchPalette shortcut hints', () => {
  it('renders the favorites action hint as a platform-aware glyph, not the literal Mod+Shift+F', async () => {
    await openPalette();
    // #54: no literal "Mod+Shift+F" anywhere.
    expect(screen.queryByText('Mod+Shift+F')).toBeNull();
    // …rendered as the macOS glyph form instead.
    expect(screen.getByText('⌘⇧F')).toBeTruthy();
  });

  it('shows hints for MULTIPLE registered actions (not just one)', async () => {
    await openPalette();
    // #55: page.new (Mod+N), theme.toggle (Mod+Shift+L), workspace.switch (Mod+Shift+O)
    // all have registry bindings and must each render a hint.
    expect(screen.getByText('⌘N')).toBeTruthy();
    expect(screen.getByText('⌘⇧L')).toBeTruthy();
    expect(screen.getByText('⌘⇧O')).toBeTruthy();
  });
});
