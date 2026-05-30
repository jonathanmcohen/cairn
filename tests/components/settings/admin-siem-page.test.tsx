// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The page is an async RSC that calls requireRole + getDb; mock both so we can
// render its returned tree in jsdom. requireRole returns a minimal ctx; getDb's
// query chain resolves to an empty forwarder list.
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({ userId: 'u1', workspaceId: 'ws1', role: 'admin' })),
}));
vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  }),
}));
// ForwarderForm pulls in browser-only bits; stub to a sentinel.
vi.mock('@/app/(app)/admin/siem/forwarder-form', () => ({
  ForwarderForm: () => <div data-testid="forwarder-form" />,
}));
// The view renders strings via useT(); use the authoritative English copy so we
// can assert visible text (mirrors tests/components/page-menu-icons.test.tsx).
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

import SiemSettingsPage from '@/app/(app)/settings/admin/siem/page';

afterEach(cleanup);

describe('settings/admin/siem page', () => {
  it('renders the SIEM heading, the breadcrumb, and the forwarder form', async () => {
    const ui = await SiemSettingsPage();
    render(ui);
    expect(screen.getByRole('heading', { name: 'SIEM forwarders' })).toBeTruthy();
    expect(screen.getByTestId('forwarder-form')).toBeTruthy();
    // Breadcrumb back-link to the Admin section.
    expect(screen.getByRole('link', { name: 'Admin' })).toBeTruthy();
  });

  it('shows the empty-state copy when no forwarders are configured', async () => {
    const ui = await SiemSettingsPage();
    render(ui);
    expect(screen.getByText('No forwarders configured yet.')).toBeTruthy();
  });
});
