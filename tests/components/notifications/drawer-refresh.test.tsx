// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationDrawer } from '@/components/notifications/drawer';

// useFocusTrap returns a ref; stub to a plain ref object so jsdom doesn't choke.
vi.mock('@/lib/a11y/focus-trap', () => ({ useFocusTrap: () => ({ current: null }) }));

// NotificationDrawer calls useRouter()/router.refresh() (G4); without a mock the
// next/navigation invariant throws. The refresh stub keeps the mark-read →
// SWR-mutate path load-bearing while satisfying the router contract.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

const feed = {
  notifications: [
    {
      id: 'n1',
      type: 'mention',
      payload: { pageId: 'p1', commentId: 'c1' },
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  ],
  unreadCount: 1,
};

describe('NotificationDrawer — real-time refresh on mark-read', () => {
  it('re-fetches the feed (SWR mutate) after marking a notification read', async () => {
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/read') || url.includes('mark-all-read')) {
        return new Response('', { status: 200 });
      }
      // Feed GET: first load shows the unread item; after mark-read it's empty.
      calls += 1;
      return new Response(
        JSON.stringify(calls === 1 ? feed : { notifications: [], unreadCount: 0 }),
        { status: 200 },
      );
    });

    render(<NotificationDrawer open onOpenChange={() => {}} />);
    // Initial feed load renders the row + its mark-read button.
    await waitFor(() => expect(screen.getByLabelText('Mark as read')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Mark as read'));
    // mutate() re-runs the feed fetcher -> "all caught up" without a page reload.
    await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeTruthy());
    fetchSpy.mockRestore();
  });
});
