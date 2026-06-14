// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageUsageCard } from '@/components/settings/storage-usage-card';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

function mockUsage(body: { usedBytes: number; limitBytes: number | null }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

describe('<StorageUsageCard>', () => {
  // v0.10.3 Q-3 — the "Unlimited" state used to be a dead-end label. It now
  // carries a docs link so admins can learn how to set a limit (interim until
  // CFG-2's in-app Storage settings page).
  it('renders a docs link in the unlimited state', async () => {
    mockUsage({ usedBytes: 1024, limitBytes: null });
    render(<StorageUsageCard />);
    const link = await screen.findByTestId('storage-unlimited-docs-link');
    expect(link.getAttribute('href')).toContain('/docs/operations.md');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('does not render the unlimited docs link when a limit is set', async () => {
    mockUsage({ usedBytes: 1024, limitBytes: 10_240 });
    render(<StorageUsageCard />);
    // The meter renders once usage resolves; the unlimited docs link must not.
    await waitFor(() => expect(screen.getByRole('meter')).toBeTruthy());
    expect(screen.queryByTestId('storage-unlimited-docs-link')).toBeNull();
  });
});
