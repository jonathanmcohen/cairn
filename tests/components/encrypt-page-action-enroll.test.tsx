// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { EncryptPageAction } from '@/components/pages/encrypt-page-action';
import { I18nProvider } from '@/lib/i18n/provider';

const ensureEnrolled = vi.fn();
const enrollKeypair = vi.fn(async (_pass: string) => ({ publicKey: 'AAAA' }));
const promptMock = vi.fn();

vi.mock('@/lib/e2e/enroll-client', () => ({
  ensureEnrolled: () => ensureEnrolled(),
  enrollKeypair: (pass: string) => enrollKeypair(pass),
  SEALED_KEY: 'cairn.e2e.sealedKeypair',
}));
vi.mock('@/components/ui/input-dialog', () => ({
  usePrompt: () => promptMock,
}));

// Stub the lazy-loaded crypto so we don't run real keypair work — we only
// assert the enrollment gate fires (or not) before the roster fetch.
vi.mock('@/lib/e2e/page-cipher', () => ({
  encryptPageContent: () => Buffer.from('ct'),
}));
vi.mock('@/lib/e2e/crypto', () => ({
  generateDek: () => Buffer.alloc(32, 1),
  wrapDek: () => Buffer.from('wrapped'),
  unlockUserKeypair: async () => ({ publicKey: Buffer.alloc(32, 9), privateKey: Buffer.alloc(32) }),
}));

function renderAction() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <EncryptPageAction
        pageId="00000000-0000-0000-0000-000000000001"
        workspaceId="00000000-0000-0000-0000-000000000002"
        currentDoc={{ type: 'doc', content: [] }}
      />
    </I18nProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  ensureEnrolled.mockReset();
  enrollKeypair.mockReset();
  enrollKeypair.mockResolvedValue({ publicKey: 'AAAA' });
  promptMock.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});

describe('<EncryptPageAction> enrollment gate (#168)', () => {
  it('runs enrollment (never-enrolled) BEFORE attempting the roster fetch', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'never-enrolled' });
    promptMock.mockResolvedValueOnce('pw').mockResolvedValueOnce('pw');
    // Roster fetch fails so the flow stops after enroll — we only assert enroll ran first.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    renderAction();
    const btn = await screen.findByRole('button', { name: enMessages['e2e.encryptPage.cta'] });
    fireEvent.click(btn);
    await waitFor(() => expect(enrollKeypair).toHaveBeenCalledWith('pw'));
  });

  it('proceeds to the roster fetch when already enrolled', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: true, stored: {} });
    promptMock.mockResolvedValue('pw');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    renderAction();
    const btn = await screen.findByRole('button', { name: enMessages['e2e.encryptPage.cta'] });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/keypair-roster')),
    );
    expect(enrollKeypair).not.toHaveBeenCalled();
  });

  it('surfaces the recovery message and does not enroll for local-blob-missing', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'local-blob-missing' });
    renderAction();
    const btn = await screen.findByRole('button', { name: enMessages['e2e.encryptPage.cta'] });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText(enMessages['e2e.enroll.recoveryNeeded'])).toBeTruthy(),
    );
    expect(enrollKeypair).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
