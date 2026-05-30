// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageActionPanels } from '@/components/pages/page-action-panels';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));
// Stub the sibling panels so this test isolates the Move-To affordance.
vi.mock('@/components/comments/comments-toggle', () => ({ CommentsToggle: () => null }));
vi.mock('@/components/pages/version-history', () => ({ VersionHistory: () => null }));
vi.mock('@/components/pages/export-menu', () => ({ PageExportMenu: () => null }));
vi.mock('@/components/pages/lock-toggle', () => ({ LockToggle: () => null }));

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

describe('PageActionPanels — Move-To', () => {
  it('editor sees a Move-To button that opens the picker and reparents', async () => {
    render(
      <PageActionPanels
        pageId={PAGE_ID}
        canComment
        currentUserId="u1"
        currentRole="editor"
        canEditVersions
        canLock={false}
        canMove
      />,
    );
    fireEvent.click(screen.getByLabelText('pageMenu.moveTo'));
    await waitFor(() => expect(screen.getByText('Target')).toBeTruthy());
    fireEvent.click(screen.getByText('Target'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('hides the Move-To button when canMove is false', () => {
    render(
      <PageActionPanels
        pageId={PAGE_ID}
        canComment={false}
        currentUserId="u1"
        currentRole="viewer"
        canEditVersions={false}
        canLock={false}
        canMove={false}
      />,
    );
    expect(screen.queryByLabelText('pageMenu.moveTo')).toBeNull();
  });
});
