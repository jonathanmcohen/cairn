// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FiltersConfig } from '@/components/databases/filters-config';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

const meta = {
  properties: [
    { id: 'p1', name: 'Title', type: 'text' },
    { id: 'p2', name: 'Priority', type: 'number' },
  ],
} as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

describe('<FiltersConfig> per-view filter writer (#162)', () => {
  it('uses radix comboboxes, not native <select>, and shows existing conditions', () => {
    const { container } = renderWithI18n(
      <FiltersConfig
        databaseId="db1"
        meta={meta}
        rows={[] as never}
        view={
          {
            id: 'v1',
            type: 'table',
            name: 'T',
            config: { filters: [{ propertyId: 'p1', op: 'contains', value: 'x' }] },
          } as never
        }
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: /filter property/i })).toBeTruthy();
  });

  it('adds a condition and PATCHes the merged config with sorts preserved', async () => {
    const onChange = vi.fn();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    renderWithI18n(
      <FiltersConfig
        databaseId="db1"
        meta={meta}
        rows={[] as never}
        view={
          {
            id: 'v1',
            type: 'table',
            name: 'T',
            config: { sorts: [{ propertyId: 'p1', direction: 'asc' }], filters: [] },
          } as never
        }
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/databases/db1/views/v1');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string) as {
      config: { filters: { propertyId: string }[]; sorts: unknown[] };
    };
    expect(body.config.filters).toHaveLength(1);
    expect(body.config.filters[0]?.propertyId).toBe('p1');
    expect(body.config.sorts).toEqual([{ propertyId: 'p1', direction: 'asc' }]);
    expect(onChange).toHaveBeenCalled();
  });
});
