// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/search?q=')) {
        return {
          ok: true,
          json: async () => ({
            results: [{ id: 'p1', title: 'Roadmap notes', snippet: null, breadcrumb: [] }],
          }),
        } as Response;
      }
      // saved-searches GET
      return { ok: true, json: async () => ({ savedSearches: [] }) } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SearchPalette ordering', () => {
  it('renders the Pages group before the Actions group when querying', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    fireEvent.change(input, { target: { value: 'road' } });

    const pages = await screen.findByText('palette.pages');
    const actions = await screen.findByText('palette.actions');
    // Pages heading must come first in document order.
    expect(pages.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
