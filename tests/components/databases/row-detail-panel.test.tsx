// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RowDetailPanel } from '@/components/databases/row-detail-panel';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

const meta = {
  database: { id: 'db1', name: 'DB' },
  properties: [
    { id: 'p1', name: 'Title', type: 'text', config: {}, position: 0 },
    { id: 'p2', name: 'Priority', type: 'number', config: {}, position: 1 },
  ],
  views: [],
} as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/rows/r1') && url.includes('/comments')) {
      return new Response(JSON.stringify({ comments: [] }), { status: 200 });
    }
    if (url.includes('/rows/r1')) {
      return new Response(
        JSON.stringify({ row: { id: 'r1' }, cells: { p1: 'Hello', p2: 3 }, body: null }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  });
});

describe('<RowDetailPanel> (#241)', () => {
  it('shows a CellEditor per property and mounts comments tab', async () => {
    renderWithI18n(
      <RowDetailPanel
        databaseId="db1"
        rowId="r1"
        meta={meta}
        open
        onOpenChange={() => {}}
        refresh={() => {}}
        canComment
        currentUserId="u1"
        currentRole="editor"
      />,
    );
    // Properties tab: one labelled control per property name.
    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toBeTruthy();
    });
    expect(screen.getByLabelText('Priority')).toBeTruthy();
    // Comments tab trigger exists.
    expect(screen.getByRole('tab', { name: /comments/i })).toBeTruthy();
  });

  it('fires onOpenChange(false) when closed', async () => {
    const onOpenChange = vi.fn();
    renderWithI18n(
      <RowDetailPanel
        databaseId="db1"
        rowId="r1"
        meta={meta}
        open
        onOpenChange={onOpenChange}
        refresh={() => {}}
        canComment
        currentUserId="u1"
        currentRole="editor"
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy());
    screen.getByRole('button', { name: /close/i }).click();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
