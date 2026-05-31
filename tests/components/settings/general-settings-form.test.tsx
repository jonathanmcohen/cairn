// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '@/app/(app)/settings/workspace/general/settings-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// IconPicker mounts a web component + dynamic import; stub it.
vi.mock('@/components/icon-picker', () => ({
  IconPicker: () => <div data-testid="icon-picker" />,
}));
// The form now reads the icon label/hint via useT(); resolve to English copy.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});
afterEach(cleanup);

describe('<SettingsForm> home page picker', () => {
  it('renders a themed combobox trigger (not a native <select>) for Home page', () => {
    const { container } = render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'W', requireTwofa: false, homePageId: null, icon: null }}
        pages={[{ id: 'p1', title: 'Welcome' }]}
      />,
    );
    // ui/select trigger has role=combobox; no *visible* native <select> should
    // remain. (Radix Select renders a hidden `aria-hidden` <select> for native
    // form submission — that internal shim is not the native picker #65 targets,
    // so it's excluded from this assertion.)
    expect(screen.getByRole('combobox', { name: /home page/i })).toBeTruthy();
    expect(container.querySelector('select:not([aria-hidden="true"])')).toBeNull();
  });
});

describe('<SettingsForm> Require 2FA control', () => {
  it('hides the Require 2FA control when enforcement is unavailable (default)', () => {
    render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'W', requireTwofa: false, homePageId: null, icon: null }}
        pages={[]}
      />,
    );
    expect(screen.queryByLabelText(/two-factor/i)).toBeNull();
  });

  it('shows the Require 2FA control when enforcement is available', () => {
    render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'W', requireTwofa: false, homePageId: null, icon: null }}
        pages={[]}
        twofaEnforcementAvailable
      />,
    );
    expect(screen.getByLabelText(/two-factor/i)).toBeTruthy();
  });
});
