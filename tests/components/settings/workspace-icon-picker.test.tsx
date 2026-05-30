// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '@/app/(app)/settings/workspace/general/settings-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// IconPicker mounts a web component + dynamic import; stub to assert it is wired
// and receives the initial icon value.
vi.mock('@/components/icon-picker', () => ({
  IconPicker: ({ value }: { value: string | null }) => (
    <div data-testid="icon-picker" data-value={value ?? ''} />
  ),
}));
// Newly-added strings (icon label/helper) run through useT(); resolve to the
// authoritative English copy. The pre-existing 2FA label stays a literal.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

describe('<SettingsForm> workspace icon', () => {
  it('renders the icon picker seeded with the workspace icon', () => {
    render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'Acme', requireTwofa: false, homePageId: null, icon: 'emoji::🪨' }}
        pages={[]}
      />,
    );
    const picker = screen.getByTestId('icon-picker');
    expect(picker).toBeTruthy();
    expect(picker.getAttribute('data-value')).toBe('emoji::🪨');
  });

  it('still hides the 2FA helper when enforcement is unavailable', () => {
    render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'Acme', requireTwofa: false, homePageId: null, icon: null }}
        pages={[]}
      />,
    );
    expect(screen.queryByLabelText('Require two-factor authentication')).toBeNull();
  });
});
