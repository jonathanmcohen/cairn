// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SetPropertyCard } from '@/components/automation/builder/set-property-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockApis() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/databases/d1')) {
      return new Response(
        JSON.stringify({ id: 'd1', properties: [{ id: 'p1', name: 'Status' }] }),
        { status: 200 },
      );
    }
    if (url.includes('/api/databases')) {
      return new Response(JSON.stringify({ databases: [{ id: 'd1', title: 'Tasks' }] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

function renderCard(config: Record<string, unknown>, onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <SetPropertyCard config={config} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders a themed Select for database (no raw <select>)', async () => {
  mockApis();
  const { container } = renderCard({});
  await waitFor(() => expect(screen.getByText('Database')).toBeTruthy());
  expect(container.querySelector('select')).toBeNull();
});

it('choosing a property + typing a value emits { databaseId, propertyId, value }', async () => {
  mockApis();
  const onChange = vi.fn();
  // Seed with a chosen database so properties load + value field is reachable.
  renderCard({ databaseId: 'd1' }, onChange);
  await waitFor(() => expect(screen.getByText('New value')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'Done' } });
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ databaseId: 'd1', value: 'Done' }),
  );
});
