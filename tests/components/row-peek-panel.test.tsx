// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowPeekPanel } from '@/components/databases/row-peek-panel';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
vi.mock('@/components/comments/row-comments', () => ({
  RowComments: (p: { databaseId: string; rowId: string }) => (
    <div data-testid="row-comments">
      {p.databaseId}:{p.rowId}
    </div>
  ),
}));

afterEach(cleanup);

describe('<RowPeekPanel>', () => {
  it('renders the Comments heading + RowComments when open', () => {
    render(
      <RowPeekPanel
        databaseId="db1"
        rowId="r1"
        open
        onOpenChange={() => {}}
        canComment
        currentUserId="u1"
        currentRole="editor"
      />,
    );
    expect(screen.getByText('Comments')).toBeTruthy();
    expect(screen.getByTestId('row-comments').textContent).toBe('db1:r1');
  });

  it('does not render dialog content when closed', () => {
    render(
      <RowPeekPanel
        databaseId="db1"
        rowId="r1"
        open={false}
        onOpenChange={() => {}}
        canComment
        currentUserId="u1"
        currentRole="editor"
      />,
    );
    expect(screen.queryByTestId('row-comments')).toBeNull();
  });
});
