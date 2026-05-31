// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '@/components/comments/comment-panel';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));
vi.mock('@/components/comments/comment-composer', () => ({
  CommentComposer: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="composer" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

afterEach(cleanup);

describe('CommentPanel — new comment appears without reload', () => {
  it('appends the created comment to the list in place', async () => {
    const created = {
      id: 'c1',
      body: 'Hello there',
      authorId: 'user-1',
      anchor: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      // Initial refetch() on open: empty list. POST: returns the created comment.
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(created), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(
      <CommentPanel
        pageId="p1"
        canComment
        currentUserId="user-1"
        currentRole="editor"
        open
        onClose={() => {}}
      />,
    );

    // Type a draft and submit.
    fireEvent.change(screen.getByLabelText('composer'), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByText('pageActions.comments.submit'));

    // The created comment renders in place — no reload, no second GET needed.
    await waitFor(() => expect(screen.getByText('Hello there')).toBeTruthy());
    fetchSpy.mockRestore();
  });
});
