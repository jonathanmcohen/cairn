// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { SortConfig } from '@/components/databases/sort-config';
import { I18nProvider } from '@/lib/i18n/provider';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

const meta = {
  properties: [
    { id: 'p1', name: 'Title', type: 'text' },
    { id: 'p2', name: 'Priority', type: 'number' },
  ],
} as never;

describe('<SortConfig> themed property picker (#38)', () => {
  it('uses a radix combobox instead of a native <select>', () => {
    const { container } = render(
      <I18nProvider locale="en" messages={enMessages}>
        <SortConfig
          databaseId="db1"
          meta={meta}
          rows={[] as never}
          view={{ id: 'v1', config: { sorts: [{ propertyId: 'p1', direction: 'asc' }] } } as never}
          onChange={() => {}}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Sort/ }));
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: /sort by property/i })).toBeTruthy();
  });
});
