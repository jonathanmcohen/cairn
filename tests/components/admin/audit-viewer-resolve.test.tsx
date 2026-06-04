// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    actorUserId: '11111111-2222-3333-4444-555555555555',
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

describe('<AuditViewer> resolution + metadata gate (#91/#92/#93)', () => {
  it('renders the resolved actor display name (#91)', async () => {
    mockEntries([entry({ actorName: 'Ada Lovelace' })]);
    renderViewer();
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
  });

  it('renders a page target as a link to /pages/<id> (#92)', async () => {
    mockEntries([
      entry({
        targetType: 'page',
        targetId: 'abc',
        targetTitle: 'Q3 Roadmap',
        targetHref: '/pages/abc',
      }),
    ]);
    renderViewer();
    const link = await screen.findByRole('link', { name: /Q3 Roadmap/i });
    expect(link.getAttribute('href')).toBe('/pages/abc');
  });

  it('renders the type:shortid fallback for an unresolved target (#92)', async () => {
    mockEntries([
      entry({
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: 'deadbeef-0000-0000-0000-000000000000',
        targetTitle: null,
        targetHref: null,
      }),
    ]);
    renderViewer();
    await waitFor(() => expect(screen.getByText(/^workspace:deadbeef$/)).toBeTruthy());
    expect(screen.queryByRole('link', { name: /deadbeef/i })).toBeNull();
  });
});
