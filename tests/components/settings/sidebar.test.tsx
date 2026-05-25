// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '@/components/settings/sidebar';

// vitest config does not enable `globals`, so @testing-library/react cannot
// auto-register its afterEach cleanup. Without it, repeated render() calls
// accumulate in document.body across tests.

// next/navigation is heavy; mock the bits we use.
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/workspace/members',
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

describe('<SettingsSidebar>', () => {
  it('renders all six section labels', () => {
    render(<SettingsSidebar />);
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

  it('marks the active section with aria-current="page"', () => {
    render(<SettingsSidebar />);
    const workspace = screen.getByRole('link', { name: 'Workspace' });
    expect(workspace.getAttribute('aria-current')).toBe('page');
    const account = screen.getByRole('link', { name: 'Account' });
    expect(account.getAttribute('aria-current')).toBeNull();
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
});
