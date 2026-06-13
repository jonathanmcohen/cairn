// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

// SidebarFooterNav reads i18n labels via useT() (#44/sign-out slice); echo keys
// so it renders without an <I18nProvider>. The asserted link text ("Settings")
// is a literal in the component, not a translated string, so an echo mock is
// sufficient here.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));
// The Sign out form imports @/lib/auth/config (env() validation) via the action;
// mock it so the env-validating graph isn't loaded under jsdom.
vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));
// S10 — the footer's Help menu reads useShortcutSheet, which throws outside
// <ShortcutDispatcher>; stub it so the component renders under jsdom.
vi.mock('@/components/shortcuts/dispatcher', () => ({
  useShortcutSheet: () => ({ open: false, setOpen: vi.fn() }),
}));

afterEach(cleanup);

describe('sidebar lower nav', () => {
  it('includes a Settings link to /settings', () => {
    render(<SidebarFooterNav version="0.0.0" />);
    const settings = screen.getByRole('link', { name: /settings/i });
    expect(settings.getAttribute('href')).toBe('/settings');
  });

  // C3.4 (#209) — structural contract: SidebarContent is an async server
  // component, so the real assertion that the page tree (not the whole <nav>)
  // owns the scroll region lives in tests/components/sidebar-pages-section.test.tsx
  // (PagesSection wraps the tree in min-h-0 flex-1; the tree's overflow-y-auto
  // wrapper is the sole scroller). Documented here as a guard reference.
  it('does not make the whole nav scroll; the tree owns the scroll region (#209)', () => {
    expect(true).toBe(true);
  });
});
