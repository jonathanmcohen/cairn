// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '@/app/(app)/settings/workspace/general/settings-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/icon-picker', () => ({
  IconPicker: () => <div data-testid="icon-picker" />,
}));
// The 2FA label is a literal (intentionally not i18n'd — see settings-form);
// the icon label/hint go through useT(), so resolve the catalog for them.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

const base = {
  workspaceId: 'ws-1',
  initial: { name: 'Acme', requireTwofa: false, homePageId: null, icon: null },
  pages: [],
};

describe('Require 2FA helper gating', () => {
  it('is hidden by default (enforcement unavailable)', () => {
    render(<SettingsForm {...base} />);
    expect(screen.queryByLabelText('Require two-factor authentication')).toBeNull();
  });

  it('is shown when twofaEnforcementAvailable is true', () => {
    render(<SettingsForm {...base} twofaEnforcementAvailable />);
    expect(screen.getByLabelText('Require two-factor authentication')).toBeTruthy();
  });
});
