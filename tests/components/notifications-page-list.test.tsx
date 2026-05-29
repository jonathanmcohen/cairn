// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPageList } from '@/components/notifications/page-list';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/notifications',
}));

afterEach(cleanup);

beforeEach(() => {
  replace.mockClear();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ notifications: [], nextCursor: null }), { status: 200 }),
  );
});

describe('notifications date filter still drives applyFilter (after DateField popover rewrite)', () => {
  it('picking a From date issues a fetch whose dateFrom is the ISO of the chosen day', async () => {
    render(
      <NotificationsPageList
        initial={{ notifications: [], nextCursor: null }}
        initialFilter={{}}
      />,
    );

    // The From field is now a themed Popover trigger, not a native date input.
    const fromTrigger = screen.getByRole('button', { name: /from/i });
    fireEvent.click(fromTrigger);
    fireEvent.click(screen.getByRole('button', { name: '15' }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
        String(c[0]),
      );
      const filterCall = calls.find((u) => u.includes('dateFrom'));
      expect(filterCall).toBeTruthy();
      // YYYY-MM-DD -> `${next}T00:00:00Z` -> ISO; the date part survives.
      const decoded = decodeURIComponent(filterCall ?? '');
      expect(decoded).toMatch(/dateFrom=\d{4}-\d{2}-15T00:00:00/);
    });
  });
});
