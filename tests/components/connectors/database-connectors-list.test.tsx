// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseConnectorsList } from '@/app/(app)/settings/developer/connectors/database-connectors-list';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

const rows = [
  {
    id: 'conn-1',
    kind: 'airtable',
    databaseId: 'db-1',
    databaseName: 'Projects',
    enabled: true,
    lastSyncedAt: null,
    unresolvedConflicts: 3,
  },
];

function renderList(connectors = rows) {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <DatabaseConnectorsList connectors={connectors} />
    </I18nProvider>,
  );
}

describe('<DatabaseConnectorsList>', () => {
  it('renders the heading + database name and kind label', () => {
    renderList();
    expect(screen.getByText('Database connectors')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Airtable')).toBeTruthy();
  });

  it('links Conflicts (N) to the existing conflict inbox route', () => {
    renderList();
    const link = screen.getByRole('link', { name: /Conflicts \(3\)/ });
    expect(link.getAttribute('href')).toBe('/settings/developer/connectors/conn-1/conflicts');
  });

  it('links Configure to the per-connector config page', () => {
    renderList();
    const link = screen.getByRole('link', { name: 'Configure' });
    expect(link.getAttribute('href')).toBe('/settings/developer/connectors/conn-1');
  });

  it('shows the heading and empty state when there are no connectors', () => {
    renderList([]);
    expect(screen.getByText('Database connectors')).toBeTruthy();
    expect(screen.getByText(/No database connectors yet/)).toBeTruthy();
  });
});
