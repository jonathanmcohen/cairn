// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditViewer } from '@/components/admin/audit-viewer';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

type Entry = {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetTitle: string | null;
  targetHref: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
};

function entry(over: Partial<Entry>): Entry {
  return {
    id: crypto.randomUUID(),
    workspaceId: 'ws-1',
    actorUserId: null,
    actorName: null,
    action: 'page.published',
    targetType: null,
    targetId: null,
    targetTitle: null,
    targetHref: null,
    metadata: {},
    ip: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function mockEntries(entries: Entry[]) {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ entries, nextCursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderViewer() {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <AuditViewer />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  mockEntries([]);
});

describe('<AuditViewer> empty-metadata gate (#93/#269)', () => {
  it('shows "No additional metadata" and no Show toggle for empty {} metadata', async () => {
    const empty = entry({ id: 'row-empty', metadata: {} });
    const full = entry({ id: 'row-full', metadata: { foo: 'bar' } });
    mockEntries([empty, full]);
    renderViewer();

    await waitFor(() => expect(screen.getByText('No additional metadata')).toBeTruthy());

    // The empty-metadata cell renders the hint and NO Show toggle.
    const emptyCell = screen.getByText('No additional metadata').closest('td');
    expect(emptyCell).toBeTruthy();
    expect(within(emptyCell as HTMLElement).queryByRole('button')).toBeNull();

    // The non-empty row has exactly one working Show toggle.
    const showButtons = screen.getAllByRole('button', { name: 'Show' });
    expect(showButtons).toHaveLength(1);
  });
});
