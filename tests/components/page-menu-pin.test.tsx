// @vitest-environment jsdom
//
// v0.10.3 Q-18 — workspace Pin/Unpin from the page ⋯ menu (admin), so curating
// the sidebar PINNED section no longer requires the Settings manager.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openMenu(props: Parameters<typeof PageMenu>[0]) {
  render(
    <I18nProvider locale="en" messages={enMessages}>
      <PageMenu {...props} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: enMessages['pageMenu.trigger'] }));
}

describe('PageMenu — workspace pin/unpin (Q-18)', () => {
  it('admin on an unpinned page sees "Pin to workspace" and POSTs to add', async () => {
    openMenu({ pageId: 'p1', canPin: true, initialPinned: false });
    const item = screen.getByTestId('page-menu-pin-toggle');
    expect(item.textContent).toContain(enMessages['pageMenu.pin']);
    fireEvent.click(item);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace/pins',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('admin on a pinned page sees "Unpin" and DELETEs', async () => {
    openMenu({ pageId: 'p1', canPin: true, initialPinned: true });
    const item = screen.getByTestId('page-menu-pin-toggle');
    expect(item.textContent).toContain(enMessages['pageMenu.unpin']);
    fireEvent.click(item);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace/pins/p1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('non-admin (canPin=false) sees no pin toggle', () => {
    openMenu({ pageId: 'p1' });
    expect(screen.queryByTestId('page-menu-pin-toggle')).toBeNull();
  });
});
