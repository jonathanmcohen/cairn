// @vitest-environment jsdom
/**
 * v0.10.0 D4 — the health panel's DEGRADED render. The e2e harness can't take
 * its own Postgres down mid-run (it would kill every later spec), so the
 * degraded snapshot is injected here and the e2e spec only exercises the
 * healthy path. Complements tests/lib/health-panel.test.ts, which proves the
 * snapshot itself degrades (down/unreachable) instead of throwing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthView } from '@/app/(app)/settings/admin/health/health-view';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

const refreshSpy = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshSpy, push: () => {} }),
}));

afterEach(() => {
  cleanup();
  refreshSpy.mockClear();
});

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

describe('<HealthView> degraded render (D4)', () => {
  it('db down renders the destructive row, alert role, and "Down" copy', () => {
    renderWithI18n(
      <HealthView
        snapshot={{ db: 'down', version: '1.2.3', uptimeSeconds: 61, collabBridge: 'connected' }}
      />,
    );
    const row = screen.getByTestId('health-db');
    expect(row.getAttribute('data-state')).toBe('down');
    // Destructive (not warning) styling: the instance is genuinely broken.
    expect(row.className).toContain('border-destructive');
    expect(screen.getByRole('alert').textContent).toBe('Down');
  });

  it('collab bridge unreachable renders the warning row + hint', () => {
    renderWithI18n(
      <HealthView
        snapshot={{ db: 'up', version: '1.2.3', uptimeSeconds: 61, collabBridge: 'unreachable' }}
      />,
    );
    const row = screen.getByTestId('health-collab');
    expect(row.getAttribute('data-state')).toBe('unreachable');
    expect(row.className).toContain('border-warning');
    expect(screen.getByText('Unreachable')).toBeTruthy();
    expect(screen.getByText(/cairn-collab service is running/)).toBeTruthy();
  });

  it('healthy snapshot renders Up/Connected with no alert and plain rows', () => {
    renderWithI18n(
      <HealthView
        snapshot={{ db: 'up', version: '1.2.3', uptimeSeconds: 3725, collabBridge: 'connected' }}
      />,
    );
    expect(screen.getByTestId('health-db').getAttribute('data-state')).toBe('up');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Up')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
    // 3725s → "1h 2m 5s" (per-replica uptime label is i18n-covered below).
    expect(screen.getByText('1h 2m 5s')).toBeTruthy();
    expect(screen.getByText('Uptime (this replica)')).toBeTruthy();
    // The machine-probe pointer row.
    expect(screen.getByTestId('health-probe-note').textContent).toContain('/healthz');
  });

  it('Refresh re-runs the RSC probes via router.refresh()', () => {
    renderWithI18n(
      <HealthView
        snapshot={{ db: 'up', version: '1.2.3', uptimeSeconds: 1, collabBridge: 'unconfigured' }}
      />,
    );
    fireEvent.click(screen.getByTestId('health-refresh'));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
