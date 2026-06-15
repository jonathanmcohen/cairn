// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemHealthPanel } from '@/components/settings/system-health-panel';
import type { SystemHealthPill } from '@/lib/health/system-health';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(cleanup);

const PILLS: SystemHealthPill[] = [
  {
    id: 'email',
    status: 'off',
    statusKey: 'systemHealth.status.notConfigured',
    fixHref: '/settings/admin/email',
  },
  {
    id: 'storage',
    status: 'ok',
    statusKey: 'systemHealth.status.configured',
    detail: { kind: 'consumers', consumers: ['backups', 'siem'] },
    fixHref: '/settings/admin/object-storage',
  },
  {
    id: 'scheduler',
    status: 'warn',
    statusKey: 'systemHealth.status.paused',
    detail: { kind: 'scheduleCount', enabledCount: 2 },
    fixHref: '/settings/admin/schedules',
  },
  {
    id: 'collab',
    status: 'warn',
    statusKey: 'systemHealth.status.degraded',
    fixHref: 'https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md',
    fixExternal: true,
  },
  {
    id: 'e2e',
    status: 'off',
    statusKey: 'systemHealth.status.off',
    // No fixHref — mirrors the e2e-off / sidebar-gating case.
  },
];

describe('SystemHealthPanel', () => {
  it('renders one pill per item', () => {
    renderWithI18n(<SystemHealthPanel pills={PILLS} />);
    for (const p of PILLS) {
      expect(screen.getByTestId(`system-health-pill-${p.id}`)).toBeTruthy();
    }
  });

  it('renders status text (not color-only) for each pill', () => {
    renderWithI18n(<SystemHealthPanel pills={PILLS} />);
    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.getByText('Configured')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Degraded')).toBeTruthy();
    // "Off" appears once (the e2e pill).
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('Fix links route to the right hrefs (internal Route vs external docs)', () => {
    renderWithI18n(<SystemHealthPanel pills={PILLS} />);
    expect(screen.getByTestId('system-health-fix-email').getAttribute('href')).toBe(
      '/settings/admin/email',
    );
    expect(screen.getByTestId('system-health-fix-storage').getAttribute('href')).toBe(
      '/settings/admin/object-storage',
    );
    expect(screen.getByTestId('system-health-fix-scheduler').getAttribute('href')).toBe(
      '/settings/admin/schedules',
    );
    const collabFix = screen.getByTestId('system-health-fix-collab');
    expect(collabFix.getAttribute('href')).toContain('operations.md');
    expect(collabFix.getAttribute('target')).toBe('_blank');
  });

  it('omits the Fix link when a pill has no fixHref (e2e off)', () => {
    renderWithI18n(<SystemHealthPanel pills={PILLS} />);
    expect(screen.queryByTestId('system-health-fix-e2e')).toBeNull();
  });

  it('renders structured detail copy (consumers + plural job count)', () => {
    renderWithI18n(<SystemHealthPanel pills={PILLS} />);
    expect(screen.getByText('Consumers: backups, siem')).toBeTruthy();
    expect(screen.getByText('2 jobs enabled')).toBeTruthy();
  });
});
