// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiKeysManager } from '@/components/settings/api-keys-manager';
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

describe('<ApiKeysManager> empty state (#203)', () => {
  it('renders an iconed empty state with a Mint-a-token CTA when there are no keys', () => {
    const { container } = renderWithI18n(<ApiKeysManager initialKeys={[]} />);
    expect(screen.getByText('No API keys yet')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Mint a token' });
    expect(cta.getAttribute('href')).toBe('/settings/developer/tokens');
  });

  it('does not render the empty state when at least one key exists', () => {
    renderWithI18n(
      <ApiKeysManager
        initialKeys={[
          {
            id: 'k1',
            name: 'Key one',
            tokenPrefix: 'cairn_ab',
            role: 'viewer',
            lastUsedAt: null,
            expiresAt: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Mint a token' })).toBeNull();
  });
});
