// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/../messages/en.json';
import { SavedSearches } from '@/components/sidebar/saved-searches';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { emitMutation } from '@/lib/client/mutation-bus';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('appears after a savedSearches mutation is emitted from elsewhere', async () => {
  let payload: unknown = { savedSearches: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  render(
    <I18nProvider locale="en" messages={en}>
      <ConfirmProvider>
        <SavedSearches />
      </ConfirmProvider>
    </I18nProvider>,
  );
  // Empty → renders nothing.
  await waitFor(() => expect(screen.queryByText('Open issues')).toBeNull());

  payload = { savedSearches: [{ id: 'a', name: 'Open issues', query: 'is:open', filters: {} }] };
  emitMutation('savedSearches');
  await waitFor(() => expect(screen.getByText('Open issues')).toBeTruthy());
});
