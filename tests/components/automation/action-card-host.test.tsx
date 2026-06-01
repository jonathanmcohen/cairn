// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionCardHost } from '@/components/automation/builder/action-card-host';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockAll() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ members: [], databases: [], templates: [], webhooks: [], nodes: [] }),
        { status: 200 },
      ),
  );
}

function renderHost(type: 'notify' | 'set_property', onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <ActionCardHost type={type} config={{}} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders the notify fields when type is notify', async () => {
  mockAll();
  renderHost('notify');
  await waitFor(() => expect(screen.getByText('User to notify')).toBeTruthy());
});

it('renders the set-property database field when type is set_property', async () => {
  mockAll();
  renderHost('set_property');
  await waitFor(() => expect(screen.getByText('Database')).toBeTruthy());
});

it('shows the type selector label for the active action type', async () => {
  mockAll();
  renderHost('notify');
  await waitFor(() => expect(screen.getByText('Notify a person')).toBeTruthy());
});
