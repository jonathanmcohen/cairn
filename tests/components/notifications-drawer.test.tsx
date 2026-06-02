// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDrawer } from '@/components/notifications/drawer';

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
  it('renders when open and links to /notifications', () => {
    render(<NotificationDrawer open onOpenChange={() => {}} onMarked={() => {}} />);
    const seeAll = screen.getByRole('link', { name: /see all/i });
    expect(seeAll.getAttribute('href')).toBe('/notifications');
  });
});
