// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

// useActionAllowed must return true so the publish button is enabled
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ slug: 's1' }), { status: 200 }));
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
    // confirm dialog is shown, no fetch yet
    expect(screen.getByRole('dialog', { name: en['publishConfirm.title'] })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('publishes only after confirming in the dialog', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.publish'] }));
    fireEvent.click(screen.getByRole('button', { name: en['publishConfirm.confirm'] }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/pages/p1/publish', { method: 'POST' }),
    );
  });
});
