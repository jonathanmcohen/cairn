// @vitest-environment jsdom
// v0.10.0 Plan E E5 (polish-audit #19) — the workspace nav chrome (desktop
// aside + mobile drawer) must unmount on /settings/* routes, where
// <SettingsSidebar> is the sole left nav, and mount everywhere else.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceNavGate } from '@/components/workspace-nav-gate';

// next/navigation is heavy; mock the single hook the gate uses. The pathname
// is mutable so each test targets a different route (house pattern, see
// tests/components/settings/sidebar.test.tsx).
const pathnameMock = vi.fn((): string => '/');
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}));

// vitest config does not enable `globals`, so @testing-library/react cannot
// auto-register its afterEach cleanup.
afterEach(() => {
  cleanup();
  pathnameMock.mockReturnValue('/');
});

function renderGate(pathname: string) {
  pathnameMock.mockReturnValue(pathname);
  return render(
    <WorkspaceNavGate>
      <aside data-testid="workspace-nav-chrome" aria-label="Workspace sidebar" />
    </WorkspaceNavGate>,
  );
}

describe('<WorkspaceNavGate> (E5)', () => {
  it('renders the workspace nav chrome on the workspace home', () => {
    renderGate('/');
    expect(screen.getByTestId('workspace-nav-chrome')).toBeTruthy();
  });

  it('renders the workspace nav chrome on a page-detail route', () => {
    renderGate('/pages/0b8a4d6e-1111-4222-8333-444455556666');
    expect(screen.getByTestId('workspace-nav-chrome')).toBeTruthy();
  });

  it('unmounts the workspace nav chrome on the settings hub root', () => {
    renderGate('/settings');
    expect(screen.queryByTestId('workspace-nav-chrome')).toBeNull();
  });

  it('unmounts the workspace nav chrome on deep settings routes', () => {
    renderGate('/settings/admin/health');
    expect(screen.queryByTestId('workspace-nav-chrome')).toBeNull();
  });

  it('matches the settings segment exactly, not as a string prefix', () => {
    // No such route exists today; this pins the non-greedy contract so a
    // future sibling like /settingsish would keep its workspace nav.
    renderGate('/settingsish');
    expect(screen.getByTestId('workspace-nav-chrome')).toBeTruthy();
  });
});
