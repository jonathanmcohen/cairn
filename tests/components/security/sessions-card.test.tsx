// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionsCard } from '@/components/security/sessions-card';
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

describe('<SessionsCard>', () => {
  it('renders a real sign-out control posting to the Auth.js signout route', () => {
    const { container } = renderWithI18n(<SessionsCard />);
    const btn = screen.getByRole('button', { name: /sign out/i });
    expect(btn.getAttribute('type')).toBe('submit');
    const form = container.querySelector('form');
    expect(form?.getAttribute('action')).toBe('/api/auth/signout');
    expect(form?.getAttribute('method')).toBe('post');
  });
});
