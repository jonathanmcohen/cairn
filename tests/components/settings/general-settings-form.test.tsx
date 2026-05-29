// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '@/app/(app)/settings/workspace/general/settings-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

describe('<SettingsForm> home page picker', () => {
  it('renders a themed combobox trigger (not a native <select>) for Home page', () => {
    const { container } = render(
      <SettingsForm
        workspaceId="ws-1"
        initial={{ name: 'W', requireTwofa: false, homePageId: null }}
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
