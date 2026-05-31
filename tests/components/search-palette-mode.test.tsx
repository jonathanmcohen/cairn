// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
// Mirror the proven palette tests: a passthrough useT so labels render as keys.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  // The palette also fetches saved searches on open; return the right shape so
  // setSaved(...) doesn't receive undefined.
  const body = url.includes('/api/search/saved')
    ? { savedSearches: [] }
    : { results: [], warnings: [] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  cleanup();
});

function openPalette() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
}

describe('SearchPalette mode toggle (#164)', () => {
  it('defaults the search request to mode=fts', async () => {
    render(<SearchPalette currentUserId="11111111-1111-1111-1111-111111111111" />);
    openPalette();
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    fireEvent.change(input, { target: { value: 'roadmap' } });
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('/api/search') && u.includes('mode=fts'))).toBe(true);
    });
  });

  it('sends mode=semantic after selecting the Semantic toggle', async () => {
    render(<SearchPalette currentUserId="11111111-1111-1111-1111-111111111111" />);
    openPalette();
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    fireEvent.change(input, { target: { value: 'roadmap' } });
    // With the passthrough useT, the toggle label renders as its i18n key.
    fireEvent.click(screen.getByRole('button', { name: 'search.mode.semantic' }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('/api/search') && u.includes('mode=semantic'))).toBe(
        true,
      );
    });
  });
});
