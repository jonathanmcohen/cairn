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

describe('<TwoFactorCard>', () => {
  it('renders the set-up CTA as a themed primary button (not an off-theme grey pill)', () => {
    renderWithI18n(<TwoFactorCard initiallyEnabled={false} />);
    const btn = screen.getByRole('button', { name: /set up 2fa/i });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('text-primary-foreground');
  });
});
