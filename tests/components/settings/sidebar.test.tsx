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
    // The back-to-workspace link leads the nav, so wrap lands there.
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Back to workspace' }));
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
    // v0.10.2 P10 — Admin children now sit under collapsible sub-groups. The
    // group OWNING the active route auto-expands (Audit & Compliance here);
    // the others need an explicit header click (Identity for Members).
    pathnameMock.mockReturnValue('/settings/admin/audit');
    renderSidebar({ isAdmin: true });
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'SIEM forwarders' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
    fireEvent.click(screen.getByTestId('admin-group-identity'));
    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
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
    // Bare /settings/admin matches no child, so every sub-group starts
    // collapsed; expand the four owning groups (P10).
    for (const slug of ['integrations', 'identity', 'billing', 'quotas']) {
      fireEvent.click(screen.getByTestId(`admin-group-${slug}`));
    }
    for (const label of ['Webhooks', 'MFA policy', 'Upgrade', 'API key quotas']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('links the SSO and chat-bridge admin consoles from Admin (inside the hub)', () => {
    pathnameMock.mockReturnValue('/settings/admin');
    renderSidebar({ isAdmin: true });
    fireEvent.click(screen.getByTestId('admin-group-identity'));
    fireEvent.click(screen.getByTestId('admin-group-integrations'));
    expect(screen.getByRole('link', { name: 'SSO & SCIM' }).getAttribute('href')).toBe(
      '/settings/admin/sso',
    );
    expect(screen.getByRole('link', { name: 'Chat bridge' }).getAttribute('href')).toBe(
      '/settings/admin/chat-bridge',
    );
  });

  it('links chat bridge once, under Admin, inside the hub (#186)', () => {
    // Deep link to the chat-bridge console: its Integrations group auto-expands.
    pathnameMock.mockReturnValue('/settings/admin/chat-bridge');
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
    // /settings/admin/mfa auto-expands the Identity group, where the
    // flag-gated encryption entry lives (P10).
    pathnameMock.mockReturnValue('/settings/admin/mfa');
    renderSidebar({ isAdmin: true, e2eEnabled: false });
    expect(screen.queryByRole('link', { name: 'End-to-end encryption' })).toBeNull();
    cleanup();
    pathnameMock.mockReturnValue('/settings/admin/mfa');
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

  it('expands new Workspace children (Export / Trash retention / Pinned pages)', () => {
    pathnameMock.mockReturnValue('/settings/workspace');
    renderSidebar();
    // v0.9.9 C6 (#187) — the static-site export nav label is now the single
    // canonical "Export" term, matching the breadcrumb + page heading.
    for (const label of ['Export', 'Trash retention', 'Pinned pages']) {
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

  // --- v0.10.2 P10 — Admin collapsible sub-groups ---

  it('renders all six Admin group headers, collapsed by default on bare /settings/admin', () => {
    pathnameMock.mockReturnValue('/settings/admin');
    renderSidebar({ isAdmin: true });
    for (const slug of ['identity', 'audit', 'integrations', 'quotas', 'operations', 'billing']) {
      const header = screen.getByTestId(`admin-group-${slug}`);
      expect(header.getAttribute('aria-expanded')).toBe('false');
    }
    // No child link is mounted while everything is collapsed.
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Storage' })).toBeNull();
  });

  it('auto-expands the group owning the deep-linked route (Quotas for /settings/admin/storage)', () => {
    pathnameMock.mockReturnValue('/settings/admin/storage');
    renderSidebar({ isAdmin: true });
    expect(screen.getByTestId('admin-group-quotas').getAttribute('aria-expanded')).toBe('true');
    const storage = screen.getByRole('link', { name: 'Storage' });
    expect(storage.getAttribute('aria-current')).toBe('page');
    // Sibling groups stay collapsed — their links are NOT in the DOM.
    expect(screen.getByTestId('admin-group-identity').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'SSO & SCIM' })).toBeNull();
  });

  it('collapsing a group unmounts its links; re-expanding restores them', () => {
    pathnameMock.mockReturnValue('/settings/admin/users');
    renderSidebar({ isAdmin: true });
    const identity = screen.getByTestId('admin-group-identity');
    expect(identity.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
    fireEvent.click(identity);
    expect(identity.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'SSO & SCIM' })).toBeNull();
    fireEvent.click(identity);
    expect(identity.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
  });

  it('collapsed groups leave the arrow-nav ring (ArrowDown skips their links and the headers)', () => {
    pathnameMock.mockReturnValue('/settings/admin/audit');
    renderSidebar({ isAdmin: true });
    // Only Audit & Compliance is expanded; its last link is SIEM forwarders.
    // ArrowDown must land on the Developer section link — not on a collapsed
    // group's link nor on a group header button (headers are tab-only).
    const siem = screen.getByRole('link', { name: 'SIEM forwarders' });
    siem.focus();
    fireEvent.keyDown(siem, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Developer' }));
  });

  it('group headers wire aria-controls to the expanded panel', () => {
    pathnameMock.mockReturnValue('/settings/admin/audit');
    renderSidebar({ isAdmin: true });
    const header = screen.getByTestId('admin-group-audit');
    const panelId = header.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId as string);
    expect(panel).toBeTruthy();
    expect(panel?.querySelectorAll('a[data-settings-nav]').length).toBe(2);
  });
});
