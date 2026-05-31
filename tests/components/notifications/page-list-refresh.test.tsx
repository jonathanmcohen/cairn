// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPageList } from '@/components/notifications/page-list';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/notifications',
}));

afterEach(cleanup);

const initial = {
  notifications: [
    {
      id: 'n1',
      type: 'mention' as const,
      payload: { pageId: 'p1' },
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  ],
  nextCursor: null,
};

describe('NotificationsPageList — optimistic mark-read without reload', () => {
  it('flips the row to read in place (no F5) after mark-read', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    render(<NotificationsPageList initial={initial} initialFilter={{}} />);
    const btn = screen.getByLabelText('Mark as read');
    fireEvent.click(btn);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/notifications/n1/read',
      expect.objectContaining({ method: 'POST' }),
    );
    // Optimistic local update: the mark-read button disappears in place.
    await waitFor(() => expect(screen.queryByLabelText('Mark as read')).toBeNull());
    fetchSpy.mockRestore();
  });
});
