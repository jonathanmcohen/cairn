// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SendWebhookCard } from '@/components/automation/builder/send-webhook-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockApis() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        webhooks: [{ id: 'w1', url: 'https://x.test/hook', events: [], active: true }],
      }),
      { status: 200 },
    ),
  );
}

function renderCard(config: Record<string, unknown>, onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <SendWebhookCard config={config} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders the webhook select (no raw <select>)', async () => {
  mockApis();
  const { container } = renderCard({});
  await waitFor(() => expect(screen.getByText('Webhook')).toBeTruthy());
  expect(container.querySelector('select')).toBeNull();
});

it('shows the chosen webhook url when one is selected', async () => {
  mockApis();
  renderCard({ webhookId: 'w1' });
  await waitFor(() => expect(screen.getByText('https://x.test/hook')).toBeTruthy());
});
