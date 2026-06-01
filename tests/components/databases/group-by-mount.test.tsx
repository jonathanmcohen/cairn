// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

function mockHook(viewType: string) {
  vi.doMock('@/components/databases/use-database-data', () => ({
    useDatabaseData: () => ({
      meta: {
        database: { id: 'db1', name: 'My DB' },
        properties: [
          { id: 'p1', name: 'Title', type: 'text', config: {}, position: 0 },
          { id: 'p2', name: 'Status', type: 'select', config: { options: [] }, position: 1 },
        ],
        views: [
          { id: 'v1', type: viewType, name: viewType, config: { groupBy: 'p2' }, position: 0 },
        ],
      },
      rows: [],
      loading: false,
      refresh: () => {},
    }),
  }));
}

// vi.resetModules() between tests gives each dynamic import a fresh module
// graph; the I18nProvider must come from that same graph (matched context),
// so import it dynamically alongside the component under test.
async function renderFullPage() {
  const { I18nProvider } = await import('@/lib/i18n/provider');
  const { FullPageDatabase } = await import('@/components/databases/full-page-database');
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <FullPageDatabase databaseId="db1" />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('group-by picker mount (#162)', () => {
  it('shows the Group by picker for a list view', async () => {
    mockHook('list');
    await renderFullPage();
    expect(screen.getByRole('combobox', { name: /group by/i })).toBeTruthy();
  });

  it('does NOT show the Group by picker for a table view', async () => {
    mockHook('table');
    await renderFullPage();
    expect(screen.queryByRole('combobox', { name: /group by/i })).toBeNull();
  });
});
