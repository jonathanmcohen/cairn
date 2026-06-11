// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('<SidebarFooterNav> version chip', () => {
  // v0.10.0 E2 — the chip is now a BUTTON that opens the What's-new panel; the
  // external GitHub release link moved into the panel footer (same href +
  // target contract the chip itself used to carry).
  it('renders the version as an accessible button opening the What’s-new panel, with the external link in the panel footer', () => {
    render(<SidebarFooterNav version="9.9.9" />);
    const chip = screen.getByRole('button', { name: /9\.9\.9|release notes/i });
    // AA: must carry a PERSISTENT underline affordance (a bare `underline`
    // token, not the round-1 hover-only `hover:underline`) + a visible focus
    // ring, so non-hover/keyboard users perceive it as interactive.
    expect(chip.className).toMatch(/(^|\s)underline(\s|$)/);
    expect(chip.className).toMatch(/focus-visible:ring/);

    fireEvent.click(chip);
    const link = screen.getByRole('link', { name: /view this release on github/i });
    expect(link.getAttribute('href')).toContain('9.9.9');
    expect(link.getAttribute('target')).toBe('_blank');
    // 9.9.9 never matches the generated notes' version → the stale-notes guard
    // must show the fallback, not some other version's section (E2 test (d)).
    expect(screen.getByTestId('whats-new-fallback')).toBeTruthy();
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
