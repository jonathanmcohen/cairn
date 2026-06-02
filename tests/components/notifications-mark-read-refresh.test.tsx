// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDrawer } from '@/components/notifications/drawer';
import { NotificationsPageList } from '@/components/notifications/page-list';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: () => {}, push: () => {} }),
  usePathname: () => '/notifications',
}));

afterEach(cleanup);

beforeEach(() => {
  refresh.mockClear();
  vi.restoreAllMocks();
});

const NOTIF = {
  id: 'n1',
  type: 'mention' as const,
  payload: { pageId: 'p1' },
  readAt: null,
  createdAt: new Date().toISOString(),
};

describe('notifications mark-read live refetch', () => {
  it('page-list onMarkRead refreshes the server bell badge', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(
      <NotificationsPageList
        initial={{ notifications: [NOTIF], nextCursor: null }}
        initialFilter={{}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Mark as read'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('drawer onMarkRead refreshes the server bell badge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/read')) return new Response(null, { status: 200 });
      // SWR feed fetch.
      return new Response(JSON.stringify({ notifications: [NOTIF], unreadCount: 1 }), {
        status: 200,
      });
    });

    render(<NotificationDrawer open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Mark as read')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Mark as read'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
