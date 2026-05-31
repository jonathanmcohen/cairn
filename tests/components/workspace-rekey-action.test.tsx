// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { WorkspaceRekeyAction } from '@/components/admin/workspace-rekey-action';
import { I18nProvider } from '@/lib/i18n/provider';

const runRekey = vi.fn();
const ensureEnrolled = vi.fn();
const confirmMock = vi.fn();
const promptMock = vi.fn();

vi.mock('@/lib/e2e/rekey-client', () => ({
  runRekey: (...args: unknown[]) => runRekey(...args),
}));
vi.mock('@/lib/e2e/enroll-client', () => ({
  ensureEnrolled: () => ensureEnrolled(),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => confirmMock }));
vi.mock('@/components/ui/input-dialog', () => ({ usePrompt: () => promptMock }));

const MEMBERS = [
  { userId: 'owner-1', name: 'Owner', email: 'o@x.com', hasKeypair: true },
  { userId: 'member-2', name: 'Member Two', email: 'm2@x.com', hasKeypair: true },
  { userId: 'member-3', name: 'No Key', email: 'm3@x.com', hasKeypair: false },
];

function renderAction() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <WorkspaceRekeyAction workspaceId="00000000-0000-0000-0000-000000000002" />
    </I18nProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  runRekey.mockReset();
  runRekey.mockResolvedValue({ keyVersion: 4 });
  ensureEnrolled.mockReset();
  ensureEnrolled.mockResolvedValue({
    enrolled: true,
    stored: {
      publicKey: 'AAAA',
      encryptedPrivateKey: 'BBBB',
      kdfSalt: 'CCCC',
      kdfIters: 32768,
    },
  });
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  promptMock.mockReset();
  promptMock.mockResolvedValue('pw');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(MEMBERS), { status: 200 })),
  );
});

describe('<WorkspaceRekeyAction> (#168)', () => {
  it('renders a row per member and a rotate-only button', async () => {
    renderAction();
    await waitFor(() => expect(screen.getByText('Member Two')).toBeTruthy());
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByRole('button', { name: enMessages['e2e.rekey.rotateOnly'] })).toBeTruthy();
  });

  it('shows a warning for members without a keypair', async () => {
    renderAction();
    await waitFor(() =>
      expect(screen.getByText(enMessages['e2e.rekey.noKeypairWarning'])).toBeTruthy(),
    );
  });

  it('remove + rotate opens themed confirm, prompts, and calls runRekey with removedMemberId', async () => {
    renderAction();
    await waitFor(() => expect(screen.getByText('Member Two')).toBeTruthy());
    const removeButtons = screen.getAllByRole('button', {
      name: enMessages['e2e.rekey.removeMember'],
    });
    // owner-1 and member-2 both have a keypair → two remove buttons (in member
    // order). member-2 is the second one.
    fireEvent.click(removeButtons[1] as HTMLElement);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(runRekey).toHaveBeenCalledWith(
        expect.objectContaining({ removedMemberId: 'member-2', passphrase: 'pw' }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/version 4/i)).toBeTruthy());
  });

  it('rotate-only calls runRekey with removedMemberId null', async () => {
    renderAction();
    await waitFor(() => expect(screen.getByText('Owner')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: enMessages['e2e.rekey.rotateOnly'] }));
    await waitFor(() =>
      expect(runRekey).toHaveBeenCalledWith(expect.objectContaining({ removedMemberId: null })),
    );
  });

  it('shows an error when runRekey throws', async () => {
    runRekey.mockRejectedValue(new Error('boom'));
    renderAction();
    await waitFor(() => expect(screen.getByText('Owner')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: enMessages['e2e.rekey.rotateOnly'] }));
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy());
  });
});
