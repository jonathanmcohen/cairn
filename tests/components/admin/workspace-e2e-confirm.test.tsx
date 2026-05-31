// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

// usePrompt is only invoked AFTER the confirm is accepted; stub it so the test
// never reaches the crypto path.
vi.mock('@/components/ui/input-dialog', () => ({
  usePrompt: () => async () => null,
}));

import { WorkspaceE2EToggle } from '@/components/admin/workspace-e2e-toggle';

afterEach(cleanup);

function renderWithProviders(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </I18nProvider>,
  );
}

describe('<WorkspaceE2EToggle> confirm gate', () => {
  it('opens a confirm dialog before doing any crypto', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    renderWithProviders(<WorkspaceE2EToggle workspaceId="w1" initialMode="off" />);

    fireEvent.click(screen.getByRole('button', { name: /enable workspace-wide encryption/i }));
    expect(await screen.findByText(/enable workspace-wide encryption\?/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
