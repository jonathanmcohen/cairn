// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LockToggle } from '@/components/pages/lock-toggle';
import { I18nProvider } from '@/lib/i18n/provider';
import arMessages from '../../../messages/ar.json';
import enMessages from '../../../messages/en.json';
import esMessages from '../../../messages/es.json';

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

  it('custom-duration select contains a Minutes option', async () => {
    render(wrap(<LockToggle pageId="p1" />));
    // Open menu
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.lock.trigger'] }));
    // Open custom form
    fireEvent.click(screen.getByText(enMessages['pageActions.lock.custom']));
    // The unit select trigger must be present.
    // Open the select by clicking its trigger.
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    // A listbox with a Minutes option must be present in the document.
    expect(
      screen.getByRole('option', { name: enMessages['pageActions.lock.unitMinutes'] }),
    ).toBeTruthy();
  });

  it('choosing Minutes + amount=30 calls fetch with an expiry ~30 min from now', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    let capturedBody: { lockedUntil?: string } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/lock')) {
          capturedBody = JSON.parse((init?.body as string) ?? '{}') as { lockedUntil?: string };
        }
        return new Response(null, { status: 200 });
      }),
    );

    render(wrap(<LockToggle pageId="p1" />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.lock.trigger'] }));
    fireEvent.click(screen.getByText(enMessages['pageActions.lock.custom']));

    // Set amount to 30
    const amountInput = screen.getByLabelText(enMessages['pageActions.lock.customAmount']);
    fireEvent.change(amountInput, { target: { value: '30' } });

    // Switch unit to Minutes
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole('option', { name: enMessages['pageActions.lock.unitMinutes'] }),
    );

    // Confirm
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.lock.confirm'] }));
    // Wait for async postLock
    await vi.waitFor(() => expect(capturedBody.lockedUntil).toBeDefined());

    const expectedMs = now + 30 * 60 * 1000; // 30 min in ms
    const actualMs = new Date(capturedBody.lockedUntil!).getTime();
    // Allow 1 s tolerance for any clock jitter in the test environment.
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(1000);

    vi.restoreAllMocks();
  });

  it('all three locale files contain unitMinutes and unitLabel lock keys', () => {
    const requiredKeys = ['pageActions.lock.unitMinutes', 'pageActions.lock.unitLabel'] as const;
    for (const key of requiredKeys) {
      expect(enMessages).toHaveProperty(key);
      expect(esMessages).toHaveProperty(key);
      expect(arMessages).toHaveProperty(key);
    }
  });
});
