// @vitest-environment jsdom
/**
 * v0.10.2 S14 — workspace-level collab-health pill in the sidebar footer.
 *
 * The footer pill mirrors the active editor's page-header "Live" pill via the
 * shared <CollabStatusProvider>. These tests pin the component-level contract
 * (the e2e spec covers the editor↔footer end-to-end wiring):
 *   - status null / no provider  → pill HIDDEN
 *   - status published           → pill shows the matching i18n label + dot
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_DOT } from '@/components/collab/collab-status';
import {
  CollabStatusProvider,
  CollabStatusReporter,
} from '@/components/collab/collab-status-context';
import type { CollabStatus } from '@/components/editor/use-collab-doc';
import { SidebarFooterNav } from '@/components/sidebar-footer-nav';

// Same isolation set as the other footer-nav tests: these children pull in
// client hooks / env()-validating graphs that error under jsdom.
vi.mock('@/components/sidebar/review-due-counter', () => ({ ReviewDueCounter: () => null }));
vi.mock('@/components/sidebar/study-link', () => ({ StudyLink: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/lib/auth/sign-out-action', () => ({ signOutAction: vi.fn() }));
vi.mock('@/components/shortcuts/dispatcher', () => ({
  useShortcutSheet: () => ({ open: false, setOpen: vi.fn() }),
}));
// The nav-count badges fetch on mount; fail them open (no network in jsdom).
vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in test'));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return {
    useT: () => (key: string) => en[key] ?? key,
  };
});

afterEach(cleanup);

/** A tiny stand-in for the editor: publishes a fixed status up to the context. */
function PublishStatus({ status }: { status: CollabStatus }) {
  return <CollabStatusReporter status={status} />;
}

describe('<SidebarFooterNav> collab-status pill (S14)', () => {
  it('renders nothing when no provider is mounted (sentinel → status null)', () => {
    render(<SidebarFooterNav version="9.9.9" />);
    expect(screen.queryByTestId('footer-collab-status')).toBeNull();
  });

  it('renders nothing inside a provider with no active editor (status null)', () => {
    render(
      <CollabStatusProvider>
        <SidebarFooterNav version="9.9.9" />
      </CollabStatusProvider>,
    );
    expect(screen.queryByTestId('footer-collab-status')).toBeNull();
  });

  it('shows the "Live" label + success dot when an editor publishes connected', () => {
    render(
      <CollabStatusProvider>
        <PublishStatus status="connected" />
        <SidebarFooterNav version="9.9.9" />
      </CollabStatusProvider>,
    );
    const pill = screen.getByTestId('footer-collab-status');
    expect(pill.textContent).toContain('Live');
    expect(pill.getAttribute('title')).toBe('Live');
    expect(pill.querySelector('span[aria-hidden="true"]')?.className).toContain(
      STATUS_DOT.connected,
    );
  });

  it('tracks the published status: "Reconnecting…" with the warning dot when disconnected', () => {
    render(
      <CollabStatusProvider>
        <PublishStatus status="disconnected" />
        <SidebarFooterNav version="9.9.9" />
      </CollabStatusProvider>,
    );
    const pill = screen.getByTestId('footer-collab-status');
    expect(pill.textContent).toContain('Reconnecting…');
    expect(pill.querySelector('span[aria-hidden="true"]')?.className).toContain(
      STATUS_DOT.disconnected,
    );
  });

  it('hides again when the editor unmounts (publishes null on teardown)', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <CollabStatusProvider>
          {open && <PublishStatus status="connected" />}
          <SidebarFooterNav version="9.9.9" />
        </CollabStatusProvider>
      );
    }
    const { rerender } = render(<Harness open={true} />);
    expect(screen.getByTestId('footer-collab-status')).toBeTruthy();
    act(() => rerender(<Harness open={false} />));
    expect(screen.queryByTestId('footer-collab-status')).toBeNull();
  });
});
