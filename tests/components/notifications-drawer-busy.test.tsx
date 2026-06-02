// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const feed = {
  notifications: [
    {
      id: 'a',
      type: 'mention',
      payload: { pageId: 'p1' },
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  ],
  unreadCount: 1,
};
vi.mock('swr', () => ({
  default: () => ({ data: feed, mutate: async () => {}, isLoading: false }),
}));

// NotificationDrawer calls useRouter()/router.refresh() (G4); without a mock the
// next/navigation invariant throws ("expected app router to be mounted").
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { NotificationDrawer } from '@/components/notifications/drawer';

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true } as never), 50)),
    ) as never,
  );
});

describe('<NotificationDrawer> busy + tooltips', () => {
  it('disables the row mark-read while in flight', async () => {
    render(<NotificationDrawer open onOpenChange={() => {}} />);
    const markAll = screen.getByRole('button', { name: 'Mark all read' });
    fireEvent.click(markAll);
    await waitFor(() => expect(markAll).toHaveProperty('disabled', true));
  });

  it('adds a title tooltip to the truncated description', () => {
    render(<NotificationDrawer open onOpenChange={() => {}} />);
    expect(screen.getByTitle('Mentioned you')).toBeTruthy();
  });
});
