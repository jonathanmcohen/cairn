// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedSearches } from '@/components/sidebar/saved-searches';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
vi.mock('@/lib/client/mutation-bus', () => ({ subscribeMutation: () => () => {} }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        savedSearches: [{ id: 's1', name: 'Open bugs', query: 'is:open', filters: {} }],
      }),
    })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('saved-search row density (#130)', () => {
  it('renders saved-search rows at the 13px density token, not text-sm', async () => {
    render(<SavedSearches />);
    await waitFor(() => screen.getByText('Open bugs'));
    const li = screen.getByText('Open bugs').closest('li');
    expect(li?.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(li?.className).toContain('leading-[var(--cairn-sidebar-leading)]');
    expect(li?.className).toContain('tracking-[0.1px]');
    expect(li?.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });
});
