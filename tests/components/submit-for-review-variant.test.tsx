// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubmitForReviewButton } from '@/components/pages/submit-for-review-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (key: string) => key }));

afterEach(cleanup);

describe('SubmitForReviewButton', () => {
  it('renders as the primary (default) variant, not outline', () => {
    render(<SubmitForReviewButton pageId="p1" />);
    const btn = screen.getByRole('button', { name: /submit/i });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).not.toContain('bg-background');
  });
});
