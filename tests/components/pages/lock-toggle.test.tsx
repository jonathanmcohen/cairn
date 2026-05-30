// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LockToggle } from '@/components/pages/lock-toggle';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

describe('<LockToggle>', () => {
  it('opens a menu whose items carry icons', () => {
    render(wrap(<LockToggle pageId="p1" />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.lock.trigger'] }));
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThanOrEqual(4);
    // Each preset item carries an svg icon child.
    for (const item of items) {
      expect(item.querySelector('svg')).toBeTruthy();
    }
  });

  it('reveals a custom-duration form (number input + confirm) when "Custom…" is chosen', () => {
    render(wrap(<LockToggle pageId="p1" />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.lock.trigger'] }));
    fireEvent.click(screen.getByText(enMessages['pageActions.lock.custom']));
    // A number input for the amount appears.
    const amount = screen.getByLabelText(enMessages['pageActions.lock.customAmount']);
    expect(amount).toBeTruthy();
    expect((amount as HTMLInputElement).type).toBe('number');
    // A confirm "Lock" button appears.
    expect(
      screen.getByRole('button', { name: enMessages['pageActions.lock.confirm'] }),
    ).toBeTruthy();
  });
});
