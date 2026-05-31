// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusPicker } from '@/components/pages/status-picker';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const PAGE_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(cleanup);

describe('<StatusPicker>', () => {
  it('renders the current status badge text for draft', () => {
    render(<StatusPicker pageId={PAGE_ID} initialStatus="draft" canEdit={false} />);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('renders only a badge (no trigger) when canEdit is false', () => {
    render(<StatusPicker pageId={PAGE_ID} initialStatus="draft" canEdit={false} />);
    expect(screen.queryByRole('button', { name: 'Change status' })).toBeNull();
  });

  it('opens a menu of allowed targets for draft (In review + Archived, not Published)', async () => {
    render(<StatusPicker pageId={PAGE_ID} initialStatus="draft" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'In review' })).toBeTruthy();
    });
    expect(screen.getByRole('menuitem', { name: 'Archived' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Published' })).toBeNull();
  });

  it('POSTs the chosen target', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'review' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<StatusPicker pageId={PAGE_ID} initialStatus="draft" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }));
    const item = await screen.findByRole('menuitem', { name: 'In review' });
    fireEvent.click(item);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pages/${PAGE_ID}/status`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ to: 'review' }),
        }),
      );
    });
  });
});
