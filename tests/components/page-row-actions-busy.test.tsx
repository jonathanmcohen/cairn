// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { PageRowActionsMenu } from '@/components/sidebar/page-row-actions-menu';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: async () => ({ id: 'x' }) } as never), 50),
        ),
    ) as never,
  );
});

const node = { id: 'n1', title: 'A', parentId: null, spaceId: null, depth: 0 } as never;

describe('sidebar row add-child busy state', () => {
  it('disables the + button while add-child is in flight', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <PageRowActionsMenu node={node} />
      </I18nProvider>,
    );
    const add = screen.getByRole('button', { name: 'Add subpage' });
    fireEvent.click(add);
    await waitFor(() => expect(add).toHaveProperty('disabled', true));
  });
});
