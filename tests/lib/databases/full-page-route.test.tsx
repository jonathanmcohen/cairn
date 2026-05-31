// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({ workspaceId: 'ws1', userId: 'u1', role: 'editor' })),
  HttpError: class extends Error {
    status: number;
    constructor(status: number) {
      super('http');
      this.status = status;
    }
  },
}));
vi.mock('@/db/client', () => ({ getDb: () => ({}) }));
const notFoundSpy = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: notFoundSpy }));
vi.mock('@/lib/databases/get', () => ({
  getDatabaseWithMeta: vi.fn(async () => ({
    database: { id: 'db1', name: 'Roadmap', workspaceId: 'ws1' },
    properties: [],
    views: [],
  })),
}));
// FullPageDatabase pulls in the whole view stack; stub it to a marker.
vi.mock('@/components/databases/full-page-database', () => ({
  FullPageDatabase: ({ databaseId }: { databaseId: string }) => (
    <div data-testid="full-page-db">{databaseId}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('(app)/databases/[databaseId] route (#162)', () => {
  it('renders FullPageDatabase for an in-workspace database', async () => {
    const { default: DatabasePage } = await import('@/app/(app)/databases/[databaseId]/page');
    const ui = await DatabasePage({ params: Promise.resolve({ databaseId: 'db1' }) });
    render(
      <I18nProvider locale="en" messages={enMessages}>
        {ui}
      </I18nProvider>,
    );
    expect(screen.getByTestId('full-page-db').textContent).toBe('db1');
  });

  it('calls notFound() when the database is not in the workspace', async () => {
    const { getDatabaseWithMeta } = await import('@/lib/databases/get');
    (
      getDatabaseWithMeta as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce(null);
    const { default: DatabasePage } = await import('@/app/(app)/databases/[databaseId]/page');
    await expect(DatabasePage({ params: Promise.resolve({ databaseId: 'nope' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
