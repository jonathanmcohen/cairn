// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageLinkPopover } from '@/components/editor/page-link-popover';

beforeEach(() => {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.endsWith('/preview')) {
      return new Response(
        JSON.stringify({
          title: 'Roadmap',
          icon: '🗺️',
          firstParagraph: 'High-level plan for the next quarter.',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<PageLinkPopover>', () => {
  it('fetches and renders title + first paragraph + open-page link', async () => {
    render(<PageLinkPopover pageId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByText(/Roadmap/)).toBeTruthy();
    });
    expect(screen.getByText(/High-level plan for the next quarter\./)).toBeTruthy();
    const link = screen.getByRole('link', { name: /open page/i });
    expect(link.getAttribute('href')).toBe('/pages/00000000-0000-0000-0000-000000000001');
  });

  it('renders a loading state until the fetch resolves', async () => {
    render(<PageLinkPopover pageId="00000000-0000-0000-0000-000000000001" />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/Roadmap/)).toBeTruthy();
    });
  });

  it('renders a fallback when the fetch fails', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('boom', { status: 500 }),
    );
    render(<PageLinkPopover pageId="00000000-0000-0000-0000-000000000002" />);
    await waitFor(() => {
      expect(screen.getByText(/couldn't load preview/i)).toBeTruthy();
    });
  });
});
