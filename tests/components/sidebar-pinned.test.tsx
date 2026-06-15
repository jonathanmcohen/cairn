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

  // v0.10.3 Q-18 — admins get inline drag-reorder handles; everyone else gets
  // plain links.
  function stubPins() {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              pins: [
                {
                  pageId: 'aaaaaaaa-0000-0000-0000-000000000001',
                  title: 'Onboarding',
                  icon: null,
                  position: 0,
                },
                {
                  pageId: 'aaaaaaaa-0000-0000-0000-000000000002',
                  title: 'Roadmap',
                  icon: null,
                  position: 1,
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
  }

  it('shows drag-reorder handles for admins (canManage)', async () => {
    stubPins();
    render(<PinnedSection canManage />);
    expect(await screen.findByText('Onboarding')).toBeTruthy();
    expect(screen.getByTestId('pin-drag-aaaaaaaa-0000-0000-0000-000000000001')).toBeTruthy();
    expect(screen.getByTestId('pin-drag-aaaaaaaa-0000-0000-0000-000000000002')).toBeTruthy();
  });

  it('shows no drag handles for non-admins', async () => {
    stubPins();
    render(<PinnedSection />);
    expect(await screen.findByText('Onboarding')).toBeTruthy();
    expect(screen.queryByTestId('pin-drag-aaaaaaaa-0000-0000-0000-000000000001')).toBeNull();
  });
});
