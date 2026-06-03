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
  properties: [{ id: 'p1', name: 'Title', type: 'text' }],
} as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<FiltersConfig> optimistic add (#244)', () => {
  it('first click on Add filter shows a filter row BEFORE the PATCH resolves', async () => {
    // A never-resolving PATCH proves the row appears optimistically (not after
    // the onChange refetch): the old code only re-rendered post-refetch.
    let resolvePatch: (v: Response) => void = () => {};
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolvePatch = res;
        }),
    );
    const onChange = vi.fn();
    renderWithI18n(
      <FiltersConfig
        databaseId="db1"
        meta={meta}
        rows={[] as never}
        view={{ id: 'v1', type: 'table', name: 'T', config: { filters: [] } } as never}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    // The property Select for the new filter row is in the DOM immediately.
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /filter property/i })).toBeTruthy(),
    );
    // And the PATCH fired with the new filter in the body.
    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/databases/db1/views/v1');
    const body = JSON.parse(init.body as string) as { config: { filters: unknown[] } };
    expect(body.config.filters).toHaveLength(1);
    resolvePatch(new Response('{}', { status: 200 }));
  });
});
