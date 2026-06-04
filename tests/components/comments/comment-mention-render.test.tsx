// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '@/components/comments/comment-panel';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const UUID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  // The panel GETs /api/pages/:id/comments; return one comment whose body holds
  // a stored `@[Name](uuid)` mention token.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 'c1',
              pageId: 'p1',
              authorId: 'u2',
              body: `Hey @[Jon](${UUID}), take a look`,
              anchor: null,
              resolved: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<CommentPanel> mention render (#72)', () => {
  it('renders @[Name](uuid) in a comment body as a pill, not raw markdown', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <CommentPanel
          pageId="p1"
          canComment
          currentUserId="u1"
          currentRole="editor"
          open
          onClose={() => {}}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('@Jon')).toBeTruthy());
    const pill = screen.getByText('@Jon');
    expect(pill.className).toContain('mention');
    expect(pill.getAttribute('data-mention-id')).toBe(UUID);
    // No raw markdown token leaks into the rendered comment.
    expect(document.body.textContent).not.toContain('@[Jon]');
    expect(document.body.textContent).toContain('take a look');
  });
});
