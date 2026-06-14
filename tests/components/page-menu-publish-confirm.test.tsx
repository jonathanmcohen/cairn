// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

// useActionAllowed must return true so the publish button is enabled
// P1 — PageMenu now calls useRouter() for the lock/unlock refresh.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // Fresh Response per call: the publish-confirm dialog now issues a GET preview
  // (#70/#249) before the POST publish, so a single shared Response object would
  // be consumed twice ("Body has already been read").
  fetchSpy.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ slug: 's1' }), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function open() {
  render(
    <I18nProvider locale="en" messages={en as Record<string, string>}>
      <PageMenu pageId="p1" initialPublished={false} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: en['pageMenu.trigger'] }));
}

describe('PageMenu publish confirmation (#118)', () => {
  it('does NOT publish on the menu click — opens a confirm dialog first', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.publish'] }));
    // confirm dialog is shown, no publish POST yet (the dialog may issue a
    // GET preview of the public URL — #70/#249 — but never the publish POST).
    expect(screen.getByRole('dialog', { name: en['publishConfirm.title'] })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/pages/p1/publish', { method: 'POST' });
  });

  it('publishes only after confirming in the dialog', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.publish'] }));
    fireEvent.click(screen.getByRole('button', { name: en['publishConfirm.confirm'] }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/pages/p1/publish', { method: 'POST' }),
    );
  });

  it('shows the public URL preview before publishing (#70/#249)', async () => {
    fetchSpy.mockImplementation((input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/api/pages/p1/publish')) {
        return Promise.resolve(
          new Response(JSON.stringify({ slug: 's1', url: '/p/s1', minted: false }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.publish'] }));
    expect(await screen.findByText('/p/s1', { exact: false })).toBeTruthy();
    expect(screen.getByText(en['publishConfirm.urlLabel'])).toBeTruthy();
  });
});
