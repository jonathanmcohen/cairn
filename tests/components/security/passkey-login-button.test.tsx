/**
 * v0.9.6 G8 — passkey login button (jsdom). Mocks the browser ceremony +
 * next-auth signIn; asserts the happy-path wiring and a no-passkey 204.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { startAuthentication, signIn } = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('@simplewebauthn/browser', () => ({ startAuthentication }));
vi.mock('next-auth/react', () => ({ signIn }));
// useT throws without an <I18nProvider>; the button only needs the identity
// translator here, so stub it to echo the key suffix in an English-ish form
// that still satisfies the /passkey/i matcher.
vi.mock('@/lib/i18n/provider', () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      'login.passkey.signin': 'Sign in with a passkey',
      'login.passkey.waiting': 'Waiting for passkey…',
      'login.passkey.none': 'No passkey is registered for this email.',
      'login.passkey.optionsError': 'Could not start the passkey sign-in.',
      'login.passkey.verifyError': 'Passkey verification failed.',
      'login.passkey.signinError': 'Sign-in failed.',
    };
    return map[key] ?? key;
  },
}));

import { PasskeyLoginButton } from '@/components/security/passkey-login-button';

beforeEach(() => {
  startAuthentication.mockReset();
  signIn.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetchSequence(responses: Array<{ status: number; body?: unknown }>) {
  const f = vi.mocked(globalThis.fetch);
  for (const r of responses) {
    f.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response);
  }
}

describe('PasskeyLoginButton', () => {
  it('runs the ceremony and calls signIn with the ticket', async () => {
    mockFetchSequence([
      { status: 200, body: { options: { challenge: 'ch' } } },
      { status: 200, body: { ticket: 'tkt' } },
    ]);
    startAuthentication.mockResolvedValue({ id: 'cred' });
    signIn.mockResolvedValue({ ok: true, error: null });
    const onSuccess = vi.fn();

    render(<PasskeyLoginButton email="u@e.com" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /passkey/i }));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('passkey', {
        ticket: 'tkt',
        redirect: false,
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows a no-passkey message on a 204 options response', async () => {
    mockFetchSequence([{ status: 204 }]);
    render(<PasskeyLoginButton email="nobody@e.com" onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /passkey/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('disables the button when no email is given', () => {
    render(<PasskeyLoginButton email="" onSuccess={vi.fn()} />);
    expect((screen.getByRole('button', { name: /passkey/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
