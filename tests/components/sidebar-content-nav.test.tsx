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

afterEach(cleanup);

describe('sidebar lower nav', () => {
  it('includes a Settings link to /settings', () => {
    render(<SidebarFooterNav version="0.0.0" />);
    const settings = screen.getByRole('link', { name: /settings/i });
    expect(settings.getAttribute('href')).toBe('/settings');
  });
});
