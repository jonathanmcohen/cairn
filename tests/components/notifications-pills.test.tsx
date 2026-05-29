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

  it('#30: initial server filter (from URL) renders the matching pill pressed on first paint', () => {
    // initialFilter.type is what page.tsx#parseFilter derives from searchParams.
    render(
      <NotificationsPageList
        initial={{ notifications: [], nextCursor: null }}
        initialFilter={{ type: ['comment_reply'] }}
      />,
    );
    expect(screen.getByRole('button', { name: /replies/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /mentions/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('#30: active pill carries a non-color affordance (check icon) and a 44px target', () => {
    render(
      <NotificationsPageList
        initial={{ notifications: [], nextCursor: null }}
        initialFilter={{ type: ['mention'] }}
      />,
    );
    const mentions = screen.getByRole('button', { name: /mentions/i });
    const replies = screen.getByRole('button', { name: /replies/i });

    // ≥44px touch target.
    expect(mentions.className).toContain('min-h-11');
    expect(replies.className).toContain('min-h-11');

    // The active pill has a non-color affordance (an icon) that the inactive
    // pill lacks — so the pressed state is perceivable without colour.
    expect(mentions.querySelector('svg')).not.toBeNull();
    expect(replies.querySelector('svg')).toBeNull();
  });
});
