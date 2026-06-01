// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '@/components/comments/comment-panel';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

// The real composer is a TipTap editor (immediatelyRender:false) that does not
// render a plain <textarea> in jsdom, so stub it with a controlled textarea
// that drives onChange/onSubmit exactly like the real composer's contract. This
// keeps the test load-bearing on the production addComment → router.refresh().
vi.mock('@/components/comments/comment-composer', () => ({
  CommentComposer: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
  }) => (
    <textarea placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

afterEach(cleanup);

beforeEach(() => {
  refresh.mockClear();
  vi.restoreAllMocks();
});

describe('<CommentPanel> live refetch', () => {
  it('calls router.refresh() after a comment is added', async () => {
    const created = {
      id: 'c1',
      pageId: 'p1',
      authorId: 'u1',
      body: 'hello',
      anchor: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // initial refetch on open → empty list
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      // POST add → created comment
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));

    render(
      <CommentPanel
        pageId="p1"
        canComment
        currentUserId="u1"
        currentRole="editor"
        open
        onClose={() => {}}
      />,
    );

    // Wait for the open-time refetch to resolve.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const textarea = screen.getByPlaceholderText('pageActions.comments.placeholder');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('pageActions.comments.submit'));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
