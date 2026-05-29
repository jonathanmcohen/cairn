// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PasskeysCard } from '@/components/security/passkeys-card';
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

describe('<PasskeysCard>', () => {
  it('links to the passkeys management page with an accessible name', () => {
    renderWithI18n(<PasskeysCard />);
    const link = screen.getByRole('link', { name: /passkey/i });
    expect(link.getAttribute('href')).toBe('/settings/security/passkeys');
  });
});
