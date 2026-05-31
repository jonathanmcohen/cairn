// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarFavorites } from '@/components/sidebar-favorites';
import type { PrefEntry } from '@/lib/prefs/user-page-prefs';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

afterEach(cleanup);
beforeEach(() => refresh.mockClear());

const favs = [
  { id: 'f1', pageId: 'p1', title: 'Alpha', icon: null },
  { id: 'f2', pageId: 'p2', title: 'Beta', icon: null },
] as unknown as PrefEntry[];

describe('SidebarFavorites — real-time refresh on remove', () => {
  it('removes optimistically AND refreshes the server tree', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    render(<SidebarFavorites favorites={favs} />);
    fireEvent.click(screen.getByLabelText('Remove Alpha from favorites'));
    // Optimistic: row gone immediately.
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    // Server tree re-rendered so the Favorites server data can't go stale.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/prefs/favorites',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });
});
