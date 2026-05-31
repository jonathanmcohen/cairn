// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableView } from '@/components/databases/table-view';

vi.mock('@/lib/i18n/provider', () => ({
  useT: () => (k: string, p?: Record<string, string | number>) =>
    p && typeof p.count === 'number' ? `${p.count} ${k}` : k,
}));
vi.mock('@/components/pwa/offline-context', () => ({
  useActionAllowed: () => true,
}));
vi.mock('@/components/mobile/long-press', () => ({
  useLongPress: () => {},
}));

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
  );
});

const meta = {
  database: { id: 'db1', config: {} },
  properties: [{ id: 'p1', name: 'Name', type: 'text', config: {} }],
} as never;

const view = { id: 'v1', type: 'table', name: 'Table', config: {} };

describe('<TableView> empty state (#144)', () => {
  it('shows a 0-row count, a single first-row CTA, and no redundant hint', () => {
    render(<TableView databaseId="db1" meta={meta} rows={[]} view={view} onChange={() => {}} />);
    // Pluralised count indicator (count=0 → "other" → "0 database.rowCount").
    expect(screen.getByText(/0 database\.rowCount/)).toBeTruthy();
    // The emphasised CTA replaces the old centered emptyHint.
    expect(screen.getByRole('button', { name: 'database.empty.firstRow' })).toBeTruthy();
    expect(screen.queryByText('database.emptyHint')).toBeNull();
  });

  it('POSTs a new row when the first-row CTA is clicked', () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<TableView databaseId="db1" meta={meta} rows={[]} view={view} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'database.empty.firstRow' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/databases/db1/rows',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
