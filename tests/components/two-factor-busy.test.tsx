// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { TwoFactorCard } from '@/app/(app)/settings/security/two-factor-card';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('@/components/security/recovery-codes-card', () => ({ RecoveryCodesCard: () => null }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,x' } }));

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ secret: 's', otpauthUri: 'o', recoveryCodes: [] }),
              } as never),
            50,
          ),
        ),
    ) as never,
  );
});

describe('<TwoFactorCard> busy state', () => {
  it('disables the setup button while enrolling', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <TwoFactorCard initiallyEnabled={false} />
      </I18nProvider>,
    );
    const setup = screen.getByRole('button', { name: 'Set up 2FA' });
    fireEvent.click(setup);
    await waitFor(() => expect(setup).toHaveProperty('disabled', true));
  });
});
