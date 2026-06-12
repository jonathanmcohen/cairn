// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDrawer } from '@/components/notifications/drawer';

// SWR's default cache is module-global: without a fresh provider per render,
// the feed fetched in one test (e.g. the 1-item P15 footer test) leaks into
// the next test's drawer and the empty state never appears.
function isolated(node: ReactNode) {
  return <SWRConfig value={{ provider: () => new Map() }}>{node}</SWRConfig>;
}

// NotificationDrawer calls useRouter()/router.refresh() (G4); without a mock the
// next/navigation invariant throws ("expected app router to be mounted").
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

// The drawer fetches its feed via SWR on open. Stub fetch with a minimal empty
// feed so the shell + footer render without a network call.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('notification drawer', () => {
  it('renders when open and links to /notifications', async () => {
    // v0.10.2 P15 — the footer only renders when the feed has items, so this
    // test feeds one notification instead of the beforeEach empty feed.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              notifications: [
                {
                  id: 'n1',
                  type: 'mention',
                  payload: {},
                  readAt: null,
                  createdAt: new Date().toISOString(),
                },
              ],
              unreadCount: 1,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    render(isolated(<NotificationDrawer open onOpenChange={() => {}} onMarked={() => {}} />));
    const seeAll = await screen.findByRole('link', { name: /see all/i });
    expect(seeAll.getAttribute('href')).toBe('/notifications');
  });

  it('hides the footer entirely on the empty feed (P15)', async () => {
    render(isolated(<NotificationDrawer open onOpenChange={() => {}} onMarked={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText(/You’re all caught up/)).toBeTruthy();
    });
    expect(screen.queryByRole('link', { name: /see all/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark all read/i })).toBeNull();
  });

  it('renders an iconed empty state when the feed is empty (#221)', async () => {
    const { container } = render(
      isolated(<NotificationDrawer open onOpenChange={() => {}} onMarked={() => {}} />),
    );
    // Wait for SWR to resolve the empty feed and swap out the "Loading…" branch.
    await waitFor(() => {
      expect(screen.getByText(/You’re all caught up/)).toBeTruthy();
    });
    // The empty state mirrors the /notifications page-list: a BellOff icon.
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
