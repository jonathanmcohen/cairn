// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

// radix DropdownMenu opens on pointer events + uses pointer capture; jsdom omits
// PointerEvent and the capture methods. Polyfill them so the trigger opens.
beforeAll(() => {
  if (!('PointerEvent' in window)) {
    // @ts-expect-error jsdom polyfill
    window.PointerEvent = MouseEvent;
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

/** radix opens on pointerdown (left button), not a synthetic click in jsdom. */
function openHelpMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Help' }), {
    button: 0,
    ctrlKey: false,
  });
}

// ReviewDueCounter + ThemeToggle pull in client hooks that error under jsdom.
vi.mock('@/components/sidebar/review-due-counter', () => ({ ReviewDueCounter: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
// The Sign out form's `action={signOutAction}` imports @/lib/auth/config, which
// validates env() at module load and throws under jsdom. Mock the action.
vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));
// v0.10.2 S10 — the footer's Help menu reads useShortcutSheet, which throws
// outside <ShortcutDispatcher>. Mock it; capture setOpen so a test can assert
// the "Keyboard shortcuts" item opens the sheet.
const setShortcutSheetOpen = vi.fn();
vi.mock('@/components/shortcuts/dispatcher', () => ({
  useShortcutSheet: () => ({ open: false, setOpen: setShortcutSheetOpen }),
}));
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

afterEach(() => {
  cleanup();
  setShortcutSheetOpen.mockClear();
});

describe('<SidebarFooterNav> Help menu (S10)', () => {
  // S10 — the standalone Templates link and Replay-tour rows were removed and
  // the help-adjacent actions consolidated into a single "?" Help menu. The
  // What's-new affordance (previously the standalone version chip) moved into
  // that menu; the WhatsNewPanel mount + its GitHub-link footer are unchanged.
  it('no longer renders the standalone Templates link', () => {
    render(<SidebarFooterNav version="9.9.9" />);
    expect(screen.queryByRole('link', { name: 'Templates' })).toBeNull();
    expect(screen.queryByRole('link', { name: /templates/i })).toBeNull();
  });

  it('no longer renders a standalone Replay tour row (only the menu item)', () => {
    render(<SidebarFooterNav version="9.9.9" />);
    // Before opening the menu there is no "Replay tour" control in the footer.
    expect(screen.queryByRole('button', { name: 'Replay tour' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Replay tour' })).toBeNull();
  });

  it('exposes a single Help trigger carrying the tour anchor data-tour="help"', () => {
    const { container } = render(<SidebarFooterNav version="9.9.9" />);
    const help = screen.getByRole('button', { name: 'Help' });
    expect(help.getAttribute('data-tour')).toBe('help');
    // Tour-anchor invariant: exactly one [data-tour="help"] in the footer.
    expect(container.querySelectorAll('[data-tour="help"]').length).toBe(1);
  });

  it('opens to reveal Replay tour / Keyboard shortcuts / What’s new items', async () => {
    render(<SidebarFooterNav version="9.9.9" />);
    openHelpMenu();
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /replay tour/i })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /keyboard shortcuts/i })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /what.s new/i })).toBeTruthy();
  });

  it('Replay tour item dispatches cairn:start-tour', async () => {
    render(<SidebarFooterNav version="9.9.9" />);
    const onTour = vi.fn();
    window.addEventListener('cairn:start-tour', onTour);
    openHelpMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /replay tour/i }));
    expect(onTour).toHaveBeenCalledTimes(1);
    window.removeEventListener('cairn:start-tour', onTour);
  });

  it('Keyboard shortcuts item opens the shortcuts sheet via useShortcutSheet', async () => {
    render(<SidebarFooterNav version="9.9.9" />);
    openHelpMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /keyboard shortcuts/i }));
    expect(setShortcutSheetOpen).toHaveBeenCalledWith(true);
  });

  it('What’s new item opens the in-app panel, with the external GitHub link in the panel footer', async () => {
    render(<SidebarFooterNav version="9.9.9" />);
    openHelpMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /what.s new/i }));
    // E2 contract preserved: the panel carries the external release link, and
    // 9.9.9 never matches the generated notes' version → the fallback shows.
    const link = screen.getByRole('link', { name: /view this release on github/i });
    expect(link.getAttribute('href')).toContain('9.9.9');
    expect(link.getAttribute('target')).toBe('_blank');
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
    // icon, so it's not visually identical to My tasks / Settings.
    expect(signOut.querySelector('svg')).toBeTruthy();
  });
});
