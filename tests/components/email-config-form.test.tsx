// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailConfigForm, type EmailConfigInitial } from '@/components/settings/email-config-form';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE: EmailConfigInitial = {
  configured: true,
  source: 'db',
  host: 'smtp.example.com',
  port: 587,
  tlsMode: 'starttls',
  username: 'mailer',
  fromAddress: 'noreply@example.com',
  replyTo: '',
  passwordSet: true,
};

describe('EmailConfigForm', () => {
  it('renders the fields and a password placeholder when already set', () => {
    renderWithI18n(<EmailConfigForm initial={BASE} />);
    expect((screen.getByTestId('email-config-host') as HTMLInputElement).value).toBe(
      'smtp.example.com',
    );
    expect((screen.getByTestId('email-config-password') as HTMLInputElement).placeholder).not.toBe(
      '',
    );
  });

  it('saves without a password field when the password input is left blank', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...BASE }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<EmailConfigForm initial={BASE} />);
    fireEvent.submit(screen.getByTestId('email-config-form'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/email-config');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string);
    expect('password' in body).toBe(false);
  });

  it('includes the password only when the admin types a new one', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...BASE }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<EmailConfigForm initial={BASE} />);
    fireEvent.change(screen.getByTestId('email-config-password'), {
      target: { value: 'new-pw' },
    });
    fireEvent.submit(screen.getByTestId('email-config-form'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.password).toBe('new-pw');
  });

  it('calls the test endpoint when Send test is clicked', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<EmailConfigForm initial={BASE} />);
    fireEvent.click(screen.getByTestId('email-config-test'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/admin/email-config/test',
    );
  });
});
