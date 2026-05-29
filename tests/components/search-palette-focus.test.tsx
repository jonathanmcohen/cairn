// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

describe('SearchPalette focus', () => {
  it('focuses the search input when the palette opens', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});
