// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { E2EEnrollCard } from '@/components/security/e2e-enroll-card';
import { I18nProvider } from '@/lib/i18n/provider';

const ensureEnrolled = vi.fn();
const enrollKeypair = vi.fn(async (_pass: string) => ({ publicKey: 'AAAA' }));
const promptMock = vi.fn();

vi.mock('@/lib/e2e/enroll-client', () => ({
  ensureEnrolled: () => ensureEnrolled(),
  enrollKeypair: (pass: string) => enrollKeypair(pass),
}));
vi.mock('@/components/ui/input-dialog', () => ({
  usePrompt: () => promptMock,
}));

function renderCard() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <E2EEnrollCard />
    </I18nProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  ensureEnrolled.mockReset();
  enrollKeypair.mockReset();
  enrollKeypair.mockResolvedValue({ publicKey: 'AAAA' });
  promptMock.mockReset();
});

describe('<E2EEnrollCard> (#168)', () => {
  it('shows already-enrolled copy and no CTA when enrolled', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: true, stored: {} });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(enMessages['e2e.enroll.alreadyEnrolled'])).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: enMessages['e2e.enroll.cta'] })).toBeNull();
  });

  it('renders the CTA + warning when not enrolled', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'never-enrolled' });
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: enMessages['e2e.enroll.cta'] })).toBeTruthy(),
    );
    expect(screen.getByText(enMessages['e2e.enroll.warning'])).toBeTruthy();
  });

  it('prompts twice and calls enrollKeypair on match, then shows success', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'never-enrolled' });
    promptMock.mockResolvedValueOnce('hunter2').mockResolvedValueOnce('hunter2');
    renderCard();
    const btn = await screen.findByRole('button', { name: enMessages['e2e.enroll.cta'] });
    fireEvent.click(btn);
    await waitFor(() => expect(enrollKeypair).toHaveBeenCalledWith('hunter2'));
    expect(promptMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText(enMessages['e2e.enroll.success'])).toBeTruthy());
  });

  it('shows mismatch and does not call enrollKeypair when passphrases differ', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'never-enrolled' });
    promptMock.mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    renderCard();
    const btn = await screen.findByRole('button', { name: enMessages['e2e.enroll.cta'] });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(enMessages['e2e.enroll.mismatch'])).toBeTruthy());
    expect(enrollKeypair).not.toHaveBeenCalled();
  });

  it('renders recovery copy for local-blob-missing', async () => {
    ensureEnrolled.mockResolvedValue({ enrolled: false, reason: 'local-blob-missing' });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(enMessages['e2e.enroll.recoveryNeeded'])).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: enMessages['e2e.enroll.cta'] })).toBeNull();
  });
});
