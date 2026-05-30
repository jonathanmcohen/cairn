// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';

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

afterEach(() => {
  cleanup();
  pathnameMock.mockReturnValue('/settings/workspace/members');
});

describe('<SettingsSidebar>', () => {
  it('hides the Admin item for non-admins (default)', () => {
    render(<SettingsSidebar />);
    for (const label of ['Account', 'Workspace', 'Developer', 'Notifications', 'Security']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('shows the Admin item when isAdmin is true', () => {
    render(<SettingsSidebar isAdmin />);
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
    render(<SettingsSidebar />);
    const workspace = screen.getByRole('link', { name: 'Workspace' });
    expect(workspace.getAttribute('aria-current')).toBe('page');
    const account = screen.getByRole('link', { name: 'Account' });
    expect(account.getAttribute('aria-current')).toBeNull();
  });

  it('moves aria-current="page" to the active sub-page (parent no longer claims it)', () => {
    pathnameMock.mockReturnValue('/settings/workspace/members');
    render(<SettingsSidebar />);
    // The parent is highlighted as active but the sub-page owns the
    // current-page semantic — no two aria-current="page" in one nav.
    expect(screen.getByRole('link', { name: 'Workspace' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('aria-current')).toBe('page');
  });

  it('arrow-down moves focus to the next item', () => {
    render(<SettingsSidebar />);
    const account = screen.getByRole('link', { name: 'Account' });
    account.focus();
    fireEvent.keyDown(account, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Workspace' }));
  });

  it('arrow-up moves focus to the previous item', () => {
    render(<SettingsSidebar />);
    const workspace = screen.getByRole('link', { name: 'Workspace' });
    workspace.focus();
    fireEvent.keyDown(workspace, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Account' }));
  });

  it('arrow-down at the last item wraps to the first', () => {
    render(<SettingsSidebar />);
    const security = screen.getByRole('link', { name: 'Security' });
    security.focus();
    fireEvent.keyDown(security, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Account' }));
  });

  it('reveals Workspace sub-pages when a Workspace route is active', () => {
    pathnameMock.mockReturnValue('/settings/workspace/members');
    render(<SettingsSidebar />);
    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'General' })).toBeTruthy();
  });

  it('does not show Workspace sub-pages when a different section is active', () => {
    pathnameMock.mockReturnValue('/settings/account');
    render(<SettingsSidebar />);
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
  });
});
