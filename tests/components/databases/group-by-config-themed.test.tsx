// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupByConfig } from '@/components/databases/group-by-config';
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
    { id: 'p1', name: 'Title', type: 'text', config: {} },
    { id: 'p2', name: 'Status', type: 'select', config: { options: [{ id: 'o1', name: 'Todo' }] } },
  ],
} as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

describe('<GroupByConfig> group-by writer (#162)', () => {
  it('offers only select properties plus None', () => {
    renderWithI18n(
      <GroupByConfig
        databaseId="db1"
        meta={meta}
        rows={[] as never}
        view={{ id: 'v1', type: 'list', name: 'L', config: {} } as never}
        onChange={() => {}}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: /group by/i });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('option', { name: /none/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /status/i })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /^Title$/ })).toBeNull();
  });

  it('PATCHes groupBy with the chosen property id', async () => {
    const onChange = vi.fn();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    renderWithI18n(
      <GroupByConfig
        databaseId="db1"
        meta={meta}
        rows={[] as never}
        view={{ id: 'v1', type: 'list', name: 'L', config: { sorts: [] } } as never}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: /group by/i });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: /status/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/databases/db1/views/v1');
    const body = JSON.parse(init.body as string) as { config: { groupBy: string | null } };
    expect(body.config.groupBy).toBe('p2');
    expect(onChange).toHaveBeenCalled();
  });
});
