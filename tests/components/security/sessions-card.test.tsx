// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionsCard } from '@/components/security/sessions-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

// The sign-out form imports @/lib/auth/config (env() validation) via the action;
// mock it so the env-validating graph isn't loaded under jsdom.
vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="en" messages={getMessages('en')}>
      {node}
    </I18nProvider>
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sessionsResponse(sessions: unknown) {
  return { ok: true, json: async () => ({ sessions }) } as Response;
}

describe('SessionsCard (#70)', () => {
  it('renders fetched sessions and marks the current device', async () => {
    fetchMock.mockResolvedValueOnce(
      sessionsResponse([
        {
          id: 's1',
          userAgent: 'Chrome on macOS',
          ip: '203.0.113.9',
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          current: true,
        },
        {
          id: 's2',
          userAgent: 'Safari on iPhone',
          ip: '198.51.100.2',
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          current: false,
        },
      ]),
    );
    render(wrap(<SessionsCard />));
    expect(await screen.findByText('Chrome on macOS')).toBeTruthy();
    expect(screen.getByText('Safari on iPhone')).toBeTruthy();
    expect(screen.getByText('This device')).toBeTruthy();
  });

  it('renders a friendly device label, not the raw UA (#192)', async () => {
    fetchMock.mockResolvedValueOnce(
      sessionsResponse([
        {
          id: 's1',
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ip: '203.0.113.9',
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          current: true,
        },
      ]),
    );
    render(wrap(<SessionsCard />));
    expect(await screen.findByText('Chrome on macOS')).toBeTruthy();
    expect(screen.queryByText(/Mozilla\/5\.0/)).toBeNull();
  });

  it('clicking "Sign out everywhere else" POSTs revoke-all then refetches', async () => {
    fetchMock
      .mockResolvedValueOnce(
        sessionsResponse([
          {
            id: 's1',
            userAgent: 'this',
            ip: null,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: true,
          },
          {
            id: 's2',
            userAgent: 'phone',
            ip: null,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: false,
          },
        ]),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revoked: 1, scope: 'others' }),
      } as Response)
      .mockResolvedValueOnce(
        sessionsResponse([
          {
            id: 's1',
            userAgent: 'this',
            ip: null,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: true,
          },
        ]),
      );
    render(wrap(<SessionsCard />));
    const btn = await screen.findByRole('button', { name: 'Sign out everywhere else' });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/sessions/revoke-all',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('phone')).toBeNull());
  });

  // v0.10.3 Q-2 — per-session Revoke on non-current rows only.
  it('shows a Revoke button on other devices (not the current one) and POSTs the single-revoke route', async () => {
    fetchMock
      .mockResolvedValueOnce(
        sessionsResponse([
          {
            id: 's1',
            userAgent: 'this',
            ip: null,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: true,
          },
          {
            id: 's2',
            userAgent: 'phone',
            ip: null,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: false,
          },
        ]),
      )
      .mockResolvedValueOnce({ ok: true, json: async () => ({ revoked: true }) } as Response)
      .mockResolvedValueOnce(
        sessionsResponse([
          {
            id: 's1',
            userAgent: 'this',
            ip: null,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: true,
          },
        ]),
      );
    render(wrap(<SessionsCard />));
    await screen.findByText('phone');
    // Exactly one Revoke button — the non-current row. The current device has none.
    const revokeButtons = screen.getAllByRole('button', { name: /Revoke the session/ });
    expect(revokeButtons).toHaveLength(1);

    fireEvent.click(screen.getByTestId('revoke-session-s2'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/sessions/s2/revoke',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('phone')).toBeNull());
  });
});
