// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinnedSection } from '@/components/sidebar/pinned-section';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PinnedSection', () => {
  it('renders pins fetched from /api/workspace/pins', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/workspace/pins') {
          return new Response(
            JSON.stringify({
              pins: [
                {
                  pageId: '1199dc8a-2c4f-4400-9b1d-000000000001',
                  title: 'Onboarding',
                  icon: null,
                  position: 0,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );
    render(<PinnedSection />);
    expect(await screen.findByText('Pinned')).toBeTruthy();
    expect(await screen.findByText('Onboarding')).toBeTruthy();
  });

  it('renders nothing when there are no pins', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ pins: [] }), { status: 200 })),
    );
    const { container } = render(<PinnedSection />);
    // Let the effect run + state update.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="pinned-section"]')).toBeNull();
    });
  });
});
