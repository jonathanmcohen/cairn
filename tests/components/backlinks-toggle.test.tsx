// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BacklinksToggle } from '@/components/pages/backlinks-toggle';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

const PAGE_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('unlinked-mentions')) {
        return Promise.resolve({ ok: true, json: async () => ({ mentions: [] }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ backlinks: [], unlinkedMentions: [] }),
      });
    }),
  );
});
afterEach(cleanup);

describe('<BacklinksToggle>', () => {
  it('renders a toggle button named "Backlinks"', () => {
    render(<BacklinksToggle pageId={PAGE_ID} />);
    expect(screen.getByRole('button', { name: 'Backlinks' })).toBeTruthy();
  });

  it('does not render the panel initially', () => {
    render(<BacklinksToggle pageId={PAGE_ID} />);
    expect(screen.queryByRole('heading', { name: 'Backlinks' })).toBeNull();
  });

  it('opens the panel on toggle and closes it via Close', async () => {
    render(<BacklinksToggle pageId={PAGE_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backlinks' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Backlinks' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Backlinks' })).toBeNull());
  });
});
