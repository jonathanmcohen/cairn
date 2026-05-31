// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuleList, type RuleListRow } from '@/components/automation/rule-list';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockApis() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/runs')) {
      return new Response(JSON.stringify({ runs: [] }), { status: 200 });
    }
    if (url.includes('/api/workspaces/members')) {
      return new Response(JSON.stringify({ members: [{ id: 'u1', name: 'Ada' }] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ databases: [], templates: [], webhooks: [], nodes: [] }), {
      status: 200,
    });
  });
}

const rule: RuleListRow = {
  id: 'r1',
  name: 'My rule',
  triggerEvent: 'row.created',
  condition: {},
  actionType: 'notify',
  actionConfig: { userId: 'u1' },
  enabled: true,
  createdAt: new Date().toISOString(),
  lastStatus: null,
  lastRunAt: null,
  builder: null,
};

function renderList() {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <RuleList initialRules={[rule]} canMutate />
    </I18nProvider>,
  );
}

it('Edit opens Builder + Run-history tabs; switching mounts the run history', async () => {
  mockApis();
  renderList();
  fireEvent.click(screen.getByText('Edit'));
  await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy());
  expect(screen.getByText('Run history')).toBeTruthy();
  // Builder tab shows the canvas trigger card.
  expect(screen.getByText('When this happens')).toBeTruthy();
  // Switch to Run history → empty state mounts.
  fireEvent.click(screen.getByText('Run history'));
  await waitFor(() => expect(screen.getByText('No runs yet.')).toBeTruthy());
});
