// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@/../messages/en.json';
import { VersionHistory } from '@/components/pages/version-history';
import { emitMutation } from '@/lib/client/mutation-bus';
import { I18nProvider } from '@/lib/i18n/provider';

function renderVH() {
  return render(
    <I18nProvider locale="en" messages={en}>
      <VersionHistory pageId="11111111-1111-1111-1111-111111111111" canEdit />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('refetches versions on open, on mutation-bus emit, and on window focus', async () => {
  renderVH();
  fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

  emitMutation('pageVersions');
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
});
