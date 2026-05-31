// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { SortConfig } from '@/components/databases/sort-config';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const meta = {
  properties: [{ id: 'p1', name: 'Name', type: 'text', config: {} }],
} as never;
const view = {
  id: 'v1',
  config: { sorts: [{ propertyId: 'p1', direction: 'asc' as const }] },
} as never;

describe('<SortConfig> icons + i18n', () => {
  it('renders the open button as i18n "Sort" and reorder/remove as svg', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <SortConfig databaseId="d1" meta={meta} view={view} rows={[]} onChange={() => {}} />
      </I18nProvider>,
    );
    const open = screen.getByRole('button', { name: /Sort/ });
    fireEvent.click(open);
    const up = screen.getByRole('button', { name: 'Move up' });
    const remove = screen.getByRole('button', { name: 'Remove sort' });
    expect(up.querySelector('svg')).toBeTruthy();
    expect(remove.querySelector('svg')).toBeTruthy();
    expect(up.textContent ?? '').not.toMatch(/↑|↓|✕/);
  });
});
