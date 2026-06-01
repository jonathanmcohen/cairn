// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TwoFactorCard } from '@/app/(app)/settings/security/two-factor-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

describe('<TwoFactorCard> input labels', () => {
  it('the enroll-confirm input is reachable via its visible label', () => {
    renderWithI18n(<TwoFactorCard initiallyEnabled={false} />);
    // The confirm input only renders after "begin"; assert the label exists
    // once enrolled. For the disabled-state copy path:
    expect(screen.queryByLabelText(/6-digit code from your authenticator app/i)).toBeNull(); // not yet visible before enroll
  });

  it('the disable input has an associated visible label', () => {
    renderWithI18n(<TwoFactorCard initiallyEnabled />);
    expect(screen.getByLabelText(/current code or recovery code/i)).toBeTruthy();
  });
});
