// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunHistory } from '@/components/automation/builder/run-history';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockRuns(runs: unknown[]) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ runs }), { status: 200 }),
  );
}

function renderHistory(ruleId = 'r1') {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <RunHistory ruleId={ruleId} />
    </I18nProvider>,
  );
}

it('renders run statuses, failed error text, and an expandable payload', async () => {
  mockRuns([
    {
      id: '1',
      status: 'success',
      error: null,
      triggerPayload: { a: 1 },
      createdAt: new Date().toISOString(),
    },
    {
      id: '2',
      status: 'failed',
      error: 'boom',
      triggerPayload: { b: 2 },
      createdAt: new Date().toISOString(),
    },
  ]);
  const { container } = renderHistory();
  await waitFor(() => expect(screen.getByText('success')).toBeTruthy());
  expect(screen.getByText('failed')).toBeTruthy();
  expect(screen.getByText('boom')).toBeTruthy();
  expect(container.querySelector('pre')).toBeNull();
  const payloadButtons = screen.getAllByText('Trigger payload');
  // The first one is the column header; the buttons follow.
  const btn = payloadButtons.find((el) => el.tagName === 'BUTTON');
  if (!btn) throw new Error('no payload button');
  fireEvent.click(btn);
  await waitFor(() => expect(container.querySelector('pre')).not.toBeNull());
});

it('renders the empty state when there are no runs', async () => {
  mockRuns([]);
  renderHistory();
  await waitFor(() => expect(screen.getByText('No runs yet.')).toBeTruthy());
});
