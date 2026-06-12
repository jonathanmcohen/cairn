// @vitest-environment jsdom
//
// v0.10.2 P1 — the Move-To affordance moved from the page toolbar
// (PageActionPanels) into the "…" page menu. Re-routed coverage: the menu's
// "Move to…" item opens the shared MoveToPicker and reparenting refreshes the
// router; the item is hidden when the viewer can't move (viewer role).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/pages/tree') {
        return new Response(
          JSON.stringify({
            nodes: [
              {
                id: '22222222-2222-2222-2222-222222222222',
                parentId: null,
                title: 'Target',
                icon: null,
                depth: 0,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAGE_ID = '11111111-1111-1111-1111-111111111111';

describe('PageMenu — Move-To', () => {
  it('editor sees a "Move to…" item that opens the picker and reparents', async () => {
    render(<PageMenu pageId={PAGE_ID} canMove />);
    fireEvent.click(screen.getByRole('button', { name: 'pageMenu.trigger' }));
    fireEvent.click(screen.getByRole('button', { name: 'pageMenu.moveTo' }));
    await waitFor(() => expect(screen.getByText('Target')).toBeTruthy());
    fireEvent.click(screen.getByText('Target'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('hides the "Move to…" item when canMove is false', () => {
    render(<PageMenu pageId={PAGE_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'pageMenu.trigger' }));
    expect(screen.queryByRole('button', { name: 'pageMenu.moveTo' })).toBeNull();
  });
});
