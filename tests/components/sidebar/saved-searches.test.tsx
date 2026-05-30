// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SavedSearches } from '@/components/sidebar/saved-searches';

const patch = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patch(url, init);
        return { ok: true, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ savedSearches: [{ id: 's1', name: 'Old', query: 'q', filters: {} }] }),
      } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SavedSearches rename', () => {
  it('renames via PATCH and updates the row', async () => {
    render(<SavedSearches />);
    const renameBtn = await screen.findByLabelText('savedSearches.renameLabel');
    fireEvent.click(renameBtn);
    const input = screen.getByDisplayValue('Old');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/search/saved/s1', expect.anything()),
    );
    expect(await screen.findByText('New name')).toBeTruthy();
  });
});
