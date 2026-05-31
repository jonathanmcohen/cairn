// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmitForReviewButton } from '@/components/pages/submit-for-review-button';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const PAGE_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(cleanup);

describe('<SubmitForReviewButton>', () => {
  it('renders a button named "Submit for review"', () => {
    render(<SubmitForReviewButton pageId={PAGE_ID} />);
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy();
  });

  it('POSTs { action: "request" } on click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<SubmitForReviewButton pageId={PAGE_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pages/${PAGE_ID}/approval`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'request' }),
        }),
      );
    });
  });

  it('shows error alert on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    render(<SubmitForReviewButton pageId={PAGE_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not submit for review');
    });
  });
});
