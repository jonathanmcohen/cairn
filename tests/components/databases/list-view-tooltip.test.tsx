// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListView } from '@/components/databases/list-view';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// ListView wraps content in PullToRefresh (mobile) + reads offline context.
vi.mock('@/components/mobile/pull-to-refresh', () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

const meta = {
  properties: [
    { id: 'p1', name: 'Title', type: 'text', config: {}, position: 0 },
    { id: 'p2', name: 'Notes', type: 'text', config: {}, position: 1 },
  ],
} as never;

const rows = [
  {
    row: { id: 'r1', createdAt: '2026-01-01', parentRowId: null },
    cells: { p1: 'Task one', p2: 'A very long note that would clip in the list row' },
  },
] as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<ListView> secondary-value tooltip (#162)', () => {
  it('sets a title attribute on the truncated secondary value', () => {
    renderWithI18n(
      <ListView
        databaseId="db1"
        meta={meta}
        rows={rows}
        view={{ id: 'v1', type: 'list', name: 'L', config: {} } as never}
        onChange={() => {}}
      />,
    );
    const note = screen.getByText('A very long note that would clip in the list row');
    expect(note.getAttribute('title')).toBe('A very long note that would clip in the list row');
  });
});
