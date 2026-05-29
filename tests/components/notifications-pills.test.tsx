// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPageList } from '@/components/notifications/page-list';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/notifications',
}));

afterEach(cleanup);

describe('notifications type pills', () => {
  it('exposes pressed state + muted/filled toggle styling on the Mentions/Replies pills', () => {
    render(
      <NotificationsPageList
        initial={{ notifications: [], nextCursor: null }}
        initialFilter={{ type: ['mention'] }}
      />,
    );
    const mentions = screen.getByRole('button', { name: /mentions/i });
    const replies = screen.getByRole('button', { name: /replies/i });

    // Both pills expose a boolean pressed state.
    expect(mentions.getAttribute('aria-pressed')).toBe('true');
    expect(replies.getAttribute('aria-pressed')).toBe('false');

    // Active pill is filled/primary; inactive pill is muted.
    expect(mentions.className).toContain('bg-primary');
    expect(mentions.className).toContain('text-primary-foreground');
    expect(replies.className).toContain('text-muted-foreground');
  });
});
