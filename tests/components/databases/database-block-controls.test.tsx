// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

vi.mock('@/components/databases/use-database-data', () => ({
  useDatabaseData: () => ({
    meta: {
      database: { id: 'db1', name: 'My DB' },
      properties: [{ id: 'p1', name: 'Title', type: 'text', config: {}, position: 0 }],
      views: [{ id: 'v1', type: 'table', name: 'Table', config: {}, position: 0 }],
    },
    rows: [],
    loading: false,
    refresh: () => {},
  }),
}));
// Offline context is consulted by table-view; stub it to "allowed".
vi.mock('@/components/pwa/offline-context', () => ({
  useActionAllowed: () => true,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FullPageDatabase controls cluster (#162)', () => {
  it('renders a Filter control alongside Sort', async () => {
    const { FullPageDatabase } = await import('@/components/databases/full-page-database');
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <FullPageDatabase databaseId="db1" />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: /^Filter/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Sort/ })).toBeTruthy();
  });
});
