// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpgradeApplyButton } from '@/components/admin/upgrade-apply-button';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderWithProviders(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </I18nProvider>,
  );
}

describe('<UpgradeApplyButton> confirm gate', () => {
  it('does NOT fetch until the confirm dialog is accepted', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    renderWithProviders(<UpgradeApplyButton disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /apply upgrade now/i }));
    // Dialog open, fetch not yet called.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/apply upgrade now\?/i)).toBeTruthy();

    // Cancel → still no fetch.
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/apply upgrade now\?/i)).toBeNull());
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
