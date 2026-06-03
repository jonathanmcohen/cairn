// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

// vitest config does not enable `globals`, so @testing-library/react cannot
// auto-register its afterEach cleanup. Without it, repeated render() calls
// accumulate in document.body across tests.

// next/navigation is heavy; mock the bits we use. The pathname is mutable so
// the sub-page-expansion tests can target different active routes.
const pathnameMock = vi.fn(() => '/settings/workspace/members');
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ push: vi.fn() }),
}));

// Sidebar labels resolve through useT, so every render needs the I18nProvider.
function renderSidebar(props: { isAdmin?: boolean; e2eEnabled?: boolean } = {}) {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <SettingsSidebar isAdmin={props.isAdmin} e2eEnabled={props.e2eEnabled} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  pathnameMock.mockReturnValue('/settings/workspace/members');
});

describe('<SettingsSidebar>', () => {
  it('hides the Admin item for non-admins (default)', () => {
    renderSidebar();
    for (const label of ['Account', 'Workspace', 'Developer', 'Notifications', 'Security']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('shows the Admin item when isAdmin is true', () => {
    renderSidebar({ isAdmin: true });
    for (const label of [
      'Account',
      'Workspace',
      'Admin',
      'Developer',
      'Notifications',
      'Security',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('marks the active section with aria-current="page" on an exact match', () => {
    pathnameMock.mockReturnValue('/settings/workspace');
    renderSidebar();
    const workspace = screen.getByRole('link', { name: 'Workspace' });
    expect(workspace.getAttribute('aria-current')).toBe('page');
    const account = screen.getByRole('link', { name: 'Account' });
    expect(account.getAttribute('aria-current')).toBeNull();
  });

  it('moves aria-current="page" to the active sub-page (parent no longer claims it)', () => {
    pathnameMock.mockReturnValue('/settings/workspace/members');
    renderSidebar();
    // The parent is highlighted as active but the sub-page owns the
    // current-page semantic — no two aria-current="page" in one nav.
    expect(screen.getByRole('link', { name: 'Workspace' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('aria-current')).toBe('page');
  });

  it('arrow-down moves focus to the next item', () => {
    renderSidebar();
    const account = screen.getByRole('link', { name: 'Account' });
    account.focus();
    fireEvent.keyDown(account, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Workspace' }));
  });

  it('arrow-up moves focus to the previous item', () => {
    renderSidebar();
    const workspace = screen.getByRole('link', { name: 'Workspace' });
    workspace.focus();
    fireEvent.keyDown(workspace, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Account' }));
  });

  it('arrow-down at the last item wraps to the first', () => {
    renderSidebar();
    const security = screen.getByRole('link', { name: 'Security' });
    security.focus();
    fireEvent.keyDown(security, { key: 'ArrowDown' });
    // G17 (#164): Search is the first nav entry, so wrap lands there.
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Search' }));
  });

  it('reveals Workspace sub-pages when a Workspace route is active', () => {
    pathnameMock.mockReturnValue('/settings/workspace/members');
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'General' })).toBeTruthy();
  });

  it('does not show Workspace sub-pages when a different section is active', () => {
    pathnameMock.mockReturnValue('/settings/account');
    renderSidebar();
    // "Members" appears as an Admin child too, but Admin is hidden for
    // non-admins and the Account section has no Members child.
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it('expands Admin children (Audit log / Members / SIEM) when on an admin route', () => {
    pathnameMock.mockReturnValue('/settings/admin');
    renderSidebar({ isAdmin: true });
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'SIEM forwarders' })).toBeTruthy();
  });

  it('expands Developer children (Connectors) when on a developer route', () => {
    pathnameMock.mockReturnValue('/settings/developer/connectors');
    renderSidebar({ isAdmin: true });
    expect(screen.getByRole('link', { name: 'Connectors' })).toBeTruthy();
  });

  it('hides the Admin entry entirely for non-admins', () => {
    pathnameMock.mockReturnValue('/settings/developer');
    renderSidebar({ isAdmin: false });
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  // --- G14 (#161) nav-reachability cases ---

  it('expands new Admin children (Webhooks / MFA policy / Upgrade / API key quotas) on an admin route', () => {
    pathnameMock.mockReturnValue('/settings/admin');
    renderSidebar({ isAdmin: true });
    for (const label of ['Webhooks', 'MFA policy', 'Upgrade', 'API key quotas']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('links the SSO and chat-bridge admin consoles from Admin (inside the hub)', () => {
    pathnameMock.mockReturnValue('/settings/admin');
    renderSidebar({ isAdmin: true });
    expect(screen.getByRole('link', { name: 'SSO & SCIM' }).getAttribute('href')).toBe(
      '/settings/admin/sso',
    );
    expect(screen.getByRole('link', { name: 'Chat bridge' }).getAttribute('href')).toBe(
      '/settings/admin/chat-bridge',
    );
  });

  it('links chat bridge once, under Admin, inside the hub (#186)', () => {
    pathnameMock.mockReturnValue('/settings/admin/audit');
    renderSidebar({ isAdmin: true });
    const links = screen.getAllByRole('link', { name: 'Chat bridge' });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/settings/admin/chat-bridge');
  });

  it('drops the duplicate Developer chat-bridge entries (#186)', () => {
    pathnameMock.mockReturnValue('/settings/developer');
    renderSidebar({ isAdmin: true });
    expect(screen.queryByRole('link', { name: 'Slack & Discord install' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Channel links' })).toBeNull();
  });

  it('shows the E2E encryption child only when e2eEnabled is true', () => {
    pathnameMock.mockReturnValue('/settings/admin');
    renderSidebar({ isAdmin: true, e2eEnabled: false });
    expect(screen.queryByRole('link', { name: 'End-to-end encryption' })).toBeNull();
    cleanup();
    pathnameMock.mockReturnValue('/settings/admin');
    renderSidebar({ isAdmin: true, e2eEnabled: true });
    expect(screen.getByRole('link', { name: 'End-to-end encryption' })).toBeTruthy();
  });

  it('expands new Developer children (Automation / Access tokens / Workspace archive) on a developer route', () => {
    pathnameMock.mockReturnValue('/settings/developer');
    renderSidebar({ isAdmin: true });
    for (const label of ['Automation', 'Access tokens', 'Workspace archive']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('expands new Workspace children (Static site export / Trash retention / Pinned pages)', () => {
    pathnameMock.mockReturnValue('/settings/workspace');
    renderSidebar();
    for (const label of ['Static site export', 'Trash retention', 'Pinned pages']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('expands the Account Theme child on an account route', () => {
    pathnameMock.mockReturnValue('/settings/account');
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Theme' }).getAttribute('href')).toBe(
      '/settings/account/theme',
    );
  });
});
