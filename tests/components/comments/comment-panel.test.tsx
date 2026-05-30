// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '@/components/comments/comment-panel';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

describe('<CommentPanel>', () => {
  it('renders an icon + copy empty state when there are no comments', () => {
    render(
      wrap(
        <CommentPanel
          pageId="p1"
          canComment
          currentUserId="u1"
          currentRole="editor"
          open
          onClose={() => {}}
        />,
      ),
    );
    // Empty-state title + body copy (not the bare "No comments yet.")
    expect(screen.getByText(enMessages['pageActions.comments.empty.title'])).toBeTruthy();
    expect(screen.getByText(enMessages['pageActions.comments.empty.body'])).toBeTruthy();
    // The submit button is a primary, enabled-looking control labeled from i18n
    const submit = screen.getByRole('button', {
      name: enMessages['pageActions.comments.submit'],
    });
    expect(submit.className).not.toContain('variant-ghost');
  });
});
