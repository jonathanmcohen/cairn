// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: vi.fn() } });

const mocks = vi.hoisted(() => ({
  router: { push: () => {}, refresh: () => {} },
  theme: { theme: 'light', setTheme: () => {} },
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('next-themes', () => ({ useTheme: () => mocks.theme }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

afterEach(cleanup);

describe('SearchPalette focus trap', () => {
  it('moves focus into the palette when it opens', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    // useFocusTrap focuses the first focusable child on activation.
    expect(document.activeElement).toBe(input);
  });

  it('keeps focus inside on Tab at the last element (wraps to first)', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    // Container is the Command element (input's offset ancestor with the trap ref).
    const container = input.closest('[data-cairn-palette]') as HTMLElement;
    expect(container).not.toBeNull();
    // Tab from the only focusable (input) wraps back to input.
    fireEvent.keyDown(container, { key: 'Tab' });
    expect(container.contains(document.activeElement)).toBe(true);
  });
});
