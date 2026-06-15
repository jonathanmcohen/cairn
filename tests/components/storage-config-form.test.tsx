// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StorageConfigForm,
  type StorageConfigInitial,
} from '@/components/settings/storage-config-form';
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

const BASE: StorageConfigInitial = {
  configured: true,
  source: 'db',
  provider: 's3',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'cairn-bucket',
  accessKey: 'AKIA123',
  pathPrefix: '',
  publicBucket: false,
  secretKeySet: true,
  uploadsEnabled: true,
  backupsEnabled: false,
  siemEnabled: false,
};

const UNCONFIGURED: StorageConfigInitial = {
  configured: false,
  source: 'none',
  provider: 's3',
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  accessKey: '',
  pathPrefix: '',
  publicBucket: false,
  secretKeySet: false,
  uploadsEnabled: false,
  backupsEnabled: false,
  siemEnabled: false,
};

describe('StorageConfigForm', () => {
  it('renders the fields and a secret-key placeholder when already set', () => {
    renderWithI18n(<StorageConfigForm initial={BASE} />);
    expect((screen.getByTestId('storage-config-endpoint') as HTMLInputElement).value).toBe(
      'https://s3.example.com',
    );
    expect((screen.getByTestId('storage-config-bucket') as HTMLInputElement).value).toBe(
      'cairn-bucket',
    );
    expect(
      (screen.getByTestId('storage-config-secret-key') as HTMLInputElement).placeholder,
    ).not.toBe('');
  });

  it('saves without a secretKey field when the secret input is left blank', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...BASE }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<StorageConfigForm initial={BASE} />);
    fireEvent.submit(screen.getByTestId('storage-config-form'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/object-storage-config');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string);
    expect('secretKey' in body).toBe(false);
  });

  it('includes the secretKey only when the admin types a new one', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...BASE }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<StorageConfigForm initial={BASE} />);
    fireEvent.change(screen.getByTestId('storage-config-secret-key'), {
      target: { value: 'new-secret' },
    });
    fireEvent.submit(screen.getByTestId('storage-config-form'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.secretKey).toBe('new-secret');
  });

  it('calls the test endpoint when Test connection is clicked', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithI18n(<StorageConfigForm initial={BASE} />);
    fireEvent.click(screen.getByTestId('storage-config-test'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/admin/object-storage-config/test',
    );
  });

  it('disables the consumer opt-in toggles before a config secret is set', () => {
    renderWithI18n(<StorageConfigForm initial={UNCONFIGURED} />);
    expect(
      (screen.getByTestId('storage-config-consumer-uploads') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('storage-config-consumer-backups') as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByTestId('storage-config-consumer-siem') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('storage-config-optin-hint')).toBeTruthy();
  });
});
