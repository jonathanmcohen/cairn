// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import LoginPage from '@/app/(auth)/login/page';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('next=/dash'),
}));
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('@/components/security/passkey-login-button', () => ({
  PasskeyLoginButton: () => null,
}));

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (String(input).startsWith('/api/sso/enabled')) {
        return new Response(
          JSON.stringify({
            providers: [
              {
                id: 'idp1',
                type: 'oidc',
                name: 'Okta',
                startPath: '/api/sso/oidc/init/idp1?returnTo=%2Fdash',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

describe('login page SSO buttons (#167)', () => {
  it('renders a "Sign in with <IdP>" button and navigates to the start path', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { origin: 'http://localhost', assign } as unknown as Location);

    render(
      <I18nProvider locale="en" messages={enMessages}>
        <LoginPage />
      </I18nProvider>,
    );

    const btn = await screen.findByRole('button', { name: /sign in with okta/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/api/sso/oidc/init/idp1?returnTo=%2Fdash'),
    );
  });
});
