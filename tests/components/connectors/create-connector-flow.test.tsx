// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateConnectorFlow } from '@/app/(app)/settings/developer/connectors/create-connector-flow';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(cleanup);
beforeEach(() => {
  push.mockReset();
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify({ id: 'conn-123' }), { status: 201 }),
  ) as unknown as typeof fetch;
});

function renderFlow() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <CreateConnectorFlow databases={[{ id: 'db-1', name: 'Projects' }]} />
    </I18nProvider>,
  );
}

describe('<CreateConnectorFlow>', () => {
  it('reveals the picker after clicking New database sync', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: 'New database sync' }));
    expect(screen.getByText('External system')).toBeTruthy();
    expect(screen.getByText('Database to sync')).toBeTruthy();
  });

  it('POSTs the create request and routes to the config page on success', async () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: 'New database sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create connector' }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(url).toBe('/api/connectors');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ databaseId: 'db-1', kind: 'google_sheets' });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/settings/developer/connectors/conn-123'),
    );
  });

  it('shows an error and does not navigate when the create fails', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'already connected' }), { status: 409 }),
    ) as unknown as typeof fetch;
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: 'New database sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create connector' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });
});
