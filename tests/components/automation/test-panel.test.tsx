// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TestPanel } from '@/components/automation/builder/test-panel';
import type { AutomationActionType } from '@/db/schema';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const body = {
  triggerEvent: 'row.created',
  condition: {} as Record<string, never>,
  actionType: 'notify' as AutomationActionType,
  actionConfig: { userId: 'u1' },
};

function renderPanel() {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <TestPanel body={body} />
    </I18nProvider>,
  );
}

it('shows the would-run message after a successful dry-run', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        result: { status: 'would_run', matched: true, actionSummary: 'notify user u1' },
        payload: { row: {} },
      }),
      { status: 200 },
    ),
  );
  renderPanel();
  fireEvent.click(screen.getByText('Test rule'));
  await waitFor(() => expect(screen.getByText(/This rule would run/)).toBeTruthy());
});

it('shows the condition-unmet message', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        result: { status: 'condition_unmet', matched: false, actionSummary: '' },
        payload: {},
      }),
      { status: 200 },
    ),
  );
  renderPanel();
  fireEvent.click(screen.getByText('Test rule'));
  await waitFor(() => expect(screen.getByText(/Condition not met/)).toBeTruthy());
});
