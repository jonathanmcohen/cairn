// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCodesCard } from '@/components/security/recovery-codes-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

// Regenerate is now gated behind the themed useConfirm() dialog (#138). Auto-
// confirm so this test exercises the regenerate flow without rendering a
// <ConfirmProvider> and driving the dialog.
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('<RecoveryCodesCard>', () => {
  it('renders the remaining count from a mocked fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ remaining: 7 }), { status: 200 }),
    );
    renderWithI18n(<RecoveryCodesCard />);
    await waitFor(() => expect(screen.getByText(/7/)).toBeTruthy());
  });

  it('regenerate shows the new codes and the button is primary + >=44px', async () => {
    const fresh = Array.from({ length: 10 }, (_, i) => `CODE-${i}-XXXX`);
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ recoveryCodes: fresh }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ remaining: 10 }), { status: 200 }));
    });

    renderWithI18n(<RecoveryCodesCard />);
    const btn = screen.getByRole('button', { name: /regenerate/i });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('min-h-11');

    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText('CODE-0-XXXX')).toBeTruthy());
    expect(screen.getByText('CODE-9-XXXX')).toBeTruthy();
  });
});
