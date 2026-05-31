// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('@/components/automation/builder/use-pickers', () => ({
  useMembers: () => ({ options: [], loading: false, error: null }),
  useDatabases: () => ({ options: [], loading: false, error: null }),
  useProperties: () => ({ options: [], loading: false, error: null }),
}));

import { NotifyCard } from '@/components/automation/builder/notify-card';
import { SetPropertyCard } from '@/components/automation/builder/set-property-card';

afterEach(cleanup);

describe('automation picker empty states', () => {
  it('NotifyCard shows the no-members hint', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <NotifyCard config={{}} onChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('No members match. Try a different name.')).toBeTruthy();
  });

  it('SetPropertyCard shows the no-databases hint when the database select is opened', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <SetPropertyCard config={{}} onChange={() => {}} />
      </I18nProvider>,
    );
    // Radix Select content is portal-mounted on open.
    fireEvent.click(screen.getAllByRole('combobox')[0] as HTMLElement);
    expect(screen.getByText('No databases yet. Create one to set a property.')).toBeTruthy();
  });
});
