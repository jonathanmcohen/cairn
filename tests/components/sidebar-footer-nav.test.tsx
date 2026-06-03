// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

// ReviewDueCounter + ThemeToggle pull in client hooks that error under jsdom.
vi.mock('@/components/sidebar/review-due-counter', () => ({ ReviewDueCounter: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
// The Sign out form's `action={signOutAction}` imports @/lib/auth/config, which
// validates env() at module load and throws under jsdom. Mock the action.
vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return {
    useT: () => (key: string, params?: Record<string, string | number>) => {
      const raw = en[key] ?? key;
      return params
        ? raw.replace(/\{(\w+)\}/g, (m, n) => (params[n] !== undefined ? String(params[n]) : m))
        : raw;
    },
  };
});

afterEach(cleanup);

describe('<SidebarFooterNav> version link', () => {
  it('renders the version as an accessible external link with a discernible name', () => {
    render(<SidebarFooterNav version="9.9.9" />);
    const link = screen.getByRole('link', { name: /9\.9\.9|release notes/i });
    expect(link.getAttribute('href')).toContain('9.9.9');
    expect(link.getAttribute('target')).toBe('_blank');
    // AA: must carry a PERSISTENT underline affordance (a bare `underline`
    // token, not the round-1 hover-only `hover:underline`) + a visible focus
    // ring, so non-hover/keyboard users perceive it as a link.
    expect(link.className).toMatch(/(^|\s)underline(\s|$)/);
    expect(link.className).toMatch(/focus-visible:ring/);
  });

  it('renders Favorites + Inbox nav entries before My tasks (#202)', () => {
    render(<SidebarFooterNav version="0.9.9" />);
    const favorites = screen.getByRole('link', { name: 'Favorites' });
    const inbox = screen.getByRole('link', { name: 'Inbox' });
    expect(favorites.getAttribute('href')).toBe('/favorites');
    expect(inbox.getAttribute('href')).toBe('/inbox');
    const myTasks = screen.getByRole('link', { name: 'My tasks' });
    const links = screen.getAllByRole('link');
    expect(links.indexOf(favorites)).toBeLessThan(links.indexOf(myTasks));
    expect(links.indexOf(inbox)).toBeLessThan(links.indexOf(myTasks));
  });

  it('renders the Sign out control inside a visually separated group', () => {
    render(<SidebarFooterNav version="1.0.0" />);
    const signOut = screen.getByRole('button', { name: /sign out/i });
    // The sign-out group must carry a clearly-visible separator: a full-bleed
    // (`-mx-3`) `border-t` divider that reads as a grouping boundary rather than
    // another same-looking nav-row gap.
    const group = signOut.closest('div');
    expect(group?.className).toMatch(/border-t/);
    expect(group?.className).toMatch(/-mx-3/);
    // And Sign out must read as distinct from the nav links above it — a leading
    // icon, so it's not visually identical to My tasks / Templates / Settings.
    expect(signOut.querySelector('svg')).toBeTruthy();
  });
});
