// @vitest-environment jsdom
/**
 * v0.10.2 S9 — personal-hub badges in the sidebar footer nav:
 * (1) Inbox count pill, (2) My-tasks open-count pill, (3) Favorites gold star.
 * Counts are fetched client-side on mount and FAIL OPEN: any fetch problem
 * renders no badge, never a broken nav.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

// Same isolation set as sidebar-footer-nav.test.tsx: these children pull in
// client hooks / env()-validating graphs that error under jsdom.
vi.mock('@/components/sidebar/flashcards-nav', () => ({ FlashcardsNav: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));
// v0.10.2 S10 — the footer's Help menu reads useShortcutSheet, which throws
// outside <ShortcutDispatcher>. These badge tests don't exercise the menu, so
// a no-op stub keeps the component renderable.
vi.mock('@/components/shortcuts/dispatcher', () => ({
  useShortcutSheet: () => ({ open: false, setOpen: vi.fn() }),
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  // Mirror createT()'s plural resolution: `{count}` params select `.one`/`.other`.
  const rules = new Intl.PluralRules('en');
  return {
    useT: () => (key: string, params?: Record<string, string | number>) => {
      let raw = en[key];
      if (params && typeof params.count === 'number') {
        raw = en[`${key}.${rules.select(params.count)}`] ?? en[`${key}.other`] ?? en[key];
      }
      const template = raw ?? key;
      return params
        ? template.replace(/\{(\w+)\}/g, (m, n) =>
            params[n] !== undefined ? String(params[n]) : m,
          )
        : template;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type CountResult = number | 'reject' | 'http500';

function stubCounts(counts: { inbox: CountResult; tasks: CountResult }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const value = url.includes('/api/inbox/count')
      ? counts.inbox
      : url.includes('/api/tasks/count')
        ? counts.tasks
        : 0;
    if (value === 'reject') throw new Error('network down');
    if (value === 'http500') {
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    }
    return new Response(JSON.stringify({ count: value }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('sidebar footer badges (S9) — count pills', () => {
  it('renders the inbox pill at the row’s RIGHT EDGE with the count and an sr-only label', async () => {
    stubCounts({ inbox: 3, tasks: 0 });
    render(<SidebarFooterNav version="0.10.2" />);

    const pill = await screen.findByTestId('inbox-count-pill');
    // Right edge of the row flex — ml-auto pill, NOT a corner/avatar dot.
    expect(pill.className).toMatch(/(^|\s)ml-auto(\s|$)/);
    expect(pill.className).toMatch(/rounded-full/);
    expect(pill.className).toMatch(/tabular-nums/);
    // It lives INSIDE the Inbox link row.
    const inboxLink = pill.closest('a');
    expect(inboxLink?.getAttribute('href')).toBe('/inbox');
    // Visible numeral is decorative; the i18n sr-only twin carries context.
    expect(pill.querySelector('[aria-hidden="true"]')?.textContent).toBe('3');
    expect(pill.querySelector('.sr-only')?.textContent).toBe('3 items in inbox');
  });

  it('renders the my-tasks pill with count and sr-only label (singular form at 1)', async () => {
    stubCounts({ inbox: 0, tasks: 1 });
    render(<SidebarFooterNav version="0.10.2" />);

    const pill = await screen.findByTestId('my-tasks-count-pill');
    expect(pill.closest('a')?.getAttribute('href')).toBe('/my-tasks');
    expect(pill.querySelector('[aria-hidden="true"]')?.textContent).toBe('1');
    expect(pill.querySelector('.sr-only')?.textContent).toBe('1 open task');
  });

  it('renders NO pill when a count is 0', async () => {
    const fetchMock = stubCounts({ inbox: 0, tasks: 0 });
    render(<SidebarFooterNav version="0.10.2" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // Let the resolved fetches flush before asserting absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('inbox-count-pill')).toBeNull();
    expect(screen.queryByTestId('my-tasks-count-pill')).toBeNull();
  });

  it('fails OPEN: network rejection and HTTP 500 render no pill and do not break the nav', async () => {
    const fetchMock = stubCounts({ inbox: 'reject', tasks: 'http500' });
    render(<SidebarFooterNav version="0.10.2" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('inbox-count-pill')).toBeNull();
    expect(screen.queryByTestId('my-tasks-count-pill')).toBeNull();
    // The nav itself survives — both rows still render as links.
    expect(screen.getByRole('link', { name: 'Inbox' }).getAttribute('href')).toBe('/inbox');
    expect(screen.getByRole('link', { name: 'My tasks' }).getAttribute('href')).toBe('/my-tasks');
  });
});

describe('sidebar footer badges (S9) — favorites gold star', () => {
  it('fills the star gold when favoritesCount > 0', () => {
    stubCounts({ inbox: 0, tasks: 0 });
    render(<SidebarFooterNav version="0.10.2" favoritesCount={2} />);
    const star = screen.getByTestId('favorites-star');
    expect(star.getAttribute('class')).toContain('fill-yellow-500');
    expect(star.getAttribute('class')).toContain('text-yellow-500');
  });

  it('keeps the default (un-filled) star at 0 and when the prop is omitted', () => {
    stubCounts({ inbox: 0, tasks: 0 });
    const { unmount } = render(<SidebarFooterNav version="0.10.2" favoritesCount={0} />);
    expect(screen.getByTestId('favorites-star').getAttribute('class')).not.toContain('yellow-500');
    unmount();

    render(<SidebarFooterNav version="0.10.2" />);
    expect(screen.getByTestId('favorites-star').getAttribute('class')).not.toContain('yellow-500');
  });
});
