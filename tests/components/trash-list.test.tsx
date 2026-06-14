// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrashList } from '@/components/trash-list';
import { absoluteLocal } from '@/lib/datetime/format';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => false }));

afterEach(cleanup);

// 3 days + 1 hour ago — safely inside Luxon's "3 days ago" bucket regardless of
// rounding at the day boundary.
const DELETED_AT = new Date(Date.now() - (3 * 24 + 1) * 3_600_000).toISOString();

describe('<TrashList>', () => {
  // v0.10.3 Q-8 — rows used to print the full `toLocaleString()` timestamp with
  // no hover affordance. They should now read as a relative phrase, with the
  // exact timestamp preserved in the title attribute.
  it('renders the deletion time as a relative phrase', () => {
    render(
      <TrashList
        initialItems={[{ id: 'p1', title: 'Old note', icon: null, deletedAt: DELETED_AT }]}
      />,
    );
    expect(screen.getByText(/Deleted\s+3 days ago/)).toBeTruthy();
  });

  it('keeps the absolute timestamp available on hover (title attr)', () => {
    render(
      <TrashList
        initialItems={[{ id: 'p1', title: 'Old note', icon: null, deletedAt: DELETED_AT }]}
      />,
    );
    const row = screen.getByTitle(absoluteLocal(DELETED_AT));
    expect(row.textContent).toMatch(/Deleted/);
  });
});
