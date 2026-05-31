// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { WorkspaceE2EToggle } from '@/components/admin/workspace-e2e-toggle';
import { I18nProvider } from '@/lib/i18n/provider';

const ensureEnrolled = vi.fn();
const enrollKeypair = vi.fn(async (_pass: string) => ({ publicKey: 'AAAA' }));
const promptMock = vi.fn();
const confirmMock = vi.fn();

vi.mock('@/lib/e2e/enroll-client', () => ({
  ensureEnrolled: () => ensureEnrolled(),
  enrollKeypair: (pass: string) => enrollKeypair(pass),
  SEALED_KEY: 'cairn.e2e.sealedKeypair',
}));
vi.mock('@/components/ui/input-dialog', () => ({ usePrompt: () => promptMock }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => confirmMock }));
vi.mock('@/lib/e2e/page-cipher', () => ({ encryptPageContent: () => Buffer.from('ct') }));
vi.mock('@/lib/e2e/crypto', () => ({
  generateDek: () => Buffer.alloc(32, 1),
  wrapDek: () => Buffer.from('wrapped'),
  unlockUserKeypair: async () => ({ publicKey: Buffer.alloc(32, 9), privateKey: Buffer.alloc(32) }),
}));

function renderToggle() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <WorkspaceE2EToggle workspaceId="00000000-0000-0000-0000-000000000002" initialMode="off" />
    </I18nProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  ensureEnrolled.mockReset();
  enrollKeypair.mockReset();
  enrollKeypair.mockResolvedValue({ publicKey: 'AAAA' });
  promptMock.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn());
});

describe('<WorkspaceE2EToggle> enrollment gate (#168)', () => {
  it('runs enrollment (never-enrolled) before the roster fetch + enable POST', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'never-enrolled' });
    promptMock.mockResolvedValueOnce('pw').mockResolvedValueOnce('pw');
    // roster fetch fails to stop the flow after enroll
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: enMessages['e2e.workspaceToggle.cta'] }));
    await waitFor(() => expect(enrollKeypair).toHaveBeenCalledWith('pw'));
  });

  it('proceeds directly to roster fetch when already enrolled', async () => {
    ensureEnrolled.mockResolvedValue({
      enrolled: true,
      stored: {
        publicKey: Buffer.alloc(32, 9).toString('base64'),
        encryptedPrivateKey: Buffer.alloc(60, 2).toString('base64'),
        kdfSalt: Buffer.alloc(16, 3).toString('base64'),
        kdfIters: 32768,
      },
    });
    promptMock.mockResolvedValue('pw');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: enMessages['e2e.workspaceToggle.cta'] }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/keypair-roster')),
    );
    expect(enrollKeypair).not.toHaveBeenCalled();
  });

  it('surfaces recovery copy and never POSTs /e2e/enable for local-blob-missing', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'local-blob-missing' });
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: enMessages['e2e.workspaceToggle.cta'] }));
    await waitFor(() =>
      expect(screen.getByText(enMessages['e2e.enroll.recoveryNeeded'])).toBeTruthy(),
    );
    expect(enrollKeypair).not.toHaveBeenCalled();
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).includes('/e2e/enable'))).toBe(false);
  });
});
