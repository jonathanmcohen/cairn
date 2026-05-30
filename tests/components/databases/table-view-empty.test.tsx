// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableView } from '@/components/databases/table-view';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// offline-context: action allowed by default
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

const meta = {
  database: { id: 'db1', name: 'DB', config: {} },
  properties: [{ id: 'p1', name: 'Name', type: 'text', config: {}, position: 0 }],
  views: [{ id: 'v1', type: 'table', name: 'Table', config: {}, position: 0 }],
};

function renderTable(rows: unknown[]) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <TableView
        databaseId="db1"
        meta={meta as never}
        rows={rows as never}
        view={{ id: 'v1', type: 'table', name: 'Table', config: {} }}
        onChange={() => {}}
      />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('<TableView> empty state (#100, #144)', () => {
  it('shows a "0 rows" count and an "Add your first row" CTA when empty', () => {
    renderTable([]);
    expect(screen.getByText('0 rows')).toBeTruthy();
    // v0.9.6 #144: the empty state leads with a single "Add your first row" CTA
    // (the redundant top-level "Add row" button was removed).
    expect(screen.getByRole('button', { name: 'Add your first row' })).toBeTruthy();
  });
});
