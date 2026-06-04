// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { PageAclManager } from '@/components/pages/page-acl-manager';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { I18nProvider } from '@/lib/i18n/provider';

const PID = '00000000-0000-0000-0000-000000000001';

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(cleanup);

beforeEach(() => {
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/acl-invites')) {
      if (init?.method === 'POST' || init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          invites: [
            {
              id: 'inv1',
              email: 'pending@x.io',
              permission: 'comment',
              invitedBy: 'u0',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 1_000_000).toISOString(),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/acls')) {
      if (init?.method === 'PUT' || init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          acls: [
            {
              userId: 'u1',
              name: 'Ada Lovelace',
              email: 'ada@example.com',
              image: null,
              permission: 'edit',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ members: [] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

function renderWithProviders(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </I18nProvider>,
  );
}

describe('<PageAclManager> (#167)', () => {
  it('renders the section title and an existing grant', async () => {
    renderWithProviders(<PageAclManager pageId={PID} />);
    expect(screen.getByText(enMessages['share.acl.title'])).toBeTruthy();
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());
  });
});

describe('<PageAclManager> invites + owner + transfer (#259)', () => {
  it('exposes the invite-by-email input', async () => {
    renderWithProviders(<PageAclManager pageId={PID} />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());
    expect(screen.getByLabelText(enMessages['share.acl.inviteByEmail'])).toBeTruthy();
  });

  it('sends an email invite', async () => {
    renderWithProviders(<PageAclManager pageId={PID} />);
    fireEvent.change(screen.getByLabelText(enMessages['share.acl.inviteByEmail']), {
      target: { value: 'new@x.io' },
    });
    fireEvent.click(screen.getByRole('button', { name: enMessages['share.acl.invite'] }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pages/${PID}/acl-invites`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('lists and revokes a pending invite', async () => {
    renderWithProviders(<PageAclManager pageId={PID} />);
    expect(await screen.findByText('pending@x.io')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: enMessages['share.acl.revokeInvite'] }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pages/${PID}/acl-invites`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('transfers ownership on a grant via confirm', async () => {
    renderWithProviders(<PageAclManager pageId={PID} />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: enMessages['share.acl.transfer'] }));
    // Themed confirm dialog → click the confirm action.
    fireEvent.click(
      await screen.findByRole('button', { name: enMessages['share.acl.transferConfirmAction'] }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pages/${PID}/acls`,
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
  });
});
