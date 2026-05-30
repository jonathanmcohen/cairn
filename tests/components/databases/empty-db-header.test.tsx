// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TableView } from '@/components/databases/table-view';
import type { DatabaseMeta, RowData } from '@/components/databases/use-database-data';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

// jsdom doesn't compute layout; the non-grouped body delegates to
// <VirtualizedRowBody> which reads offsetWidth/offsetHeight via
// @tanstack/react-virtual. Polyfill a viewport + ResizeObserver so the
// component mounts cleanly even though we assert on the (row-independent)
// header row. Mirrors tests/components/databases/virtualized-row-body.test.tsx.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-auto') ? 600 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-auto') ? 800 : 0;
    },
  });
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
});

afterEach(cleanup);

const meta: DatabaseMeta = {
  database: { id: 'db1', name: 'Db', config: {} },
  properties: [{ id: 'name', name: 'Name', type: 'text', config: {}, position: 0 }],
  views: [{ id: 'v1', type: 'table', name: 'Table', config: {}, position: 0 }],
};

// a10 #19 — meta with a `select` property so the grouped <table>/<thead> path
// (grouped = groupByProp?.type === 'select' + config.groupBy set) is exercised.
const groupedMeta: DatabaseMeta = {
  database: { id: 'db1', name: 'Db', config: {} },
  properties: [
    { id: 'name', name: 'Name', type: 'text', config: {}, position: 0 },
    {
      id: 'status',
      name: 'Status',
      type: 'select',
      config: { options: [{ id: 'a', name: 'A' }] },
      position: 1,
    },
  ],
  views: [{ id: 'v1', type: 'table', name: 'Table', config: { groupBy: 'status' }, position: 0 }],
};

describe('empty database rendering', () => {
  it('renders column header(s) even when there are zero rows', () => {
    const rows: RowData[] = [];
    renderWithI18n(
      <TableView
        databaseId="db1"
        meta={meta}
        rows={rows}
        view={{ id: 'v1', type: 'table', name: 'Table', config: {} }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Name')).toBeTruthy();
  });

  // The grouped path is the other empty-state branch suspected for #19: with
  // zero rows it produces zero group <tbody>s but the <thead> column header must
  // still render so the empty grouped table reads as a table, not a void.
  it('renders the column header for an empty GROUPED table view', () => {
    const rows: RowData[] = [];
    renderWithI18n(
      <TableView
        databaseId="db1"
        meta={groupedMeta}
        rows={rows}
        view={{ id: 'v1', type: 'table', name: 'Table', config: { groupBy: 'status' } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });
});
