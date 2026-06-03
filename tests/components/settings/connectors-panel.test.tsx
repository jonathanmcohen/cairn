// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsPanel } from '@/app/(app)/settings/developer/connectors/connectors-panel';

// ChatBridgeForm hits the network on submit; stub it to a sentinel so we can
// assert the picker shows/hides it without exercising fetch.
vi.mock('@/app/(app)/settings/admin/chat-bridge/chat-bridge-form', () => ({
  ChatBridgeForm: () => <div data-testid="chat-bridge-form" />,
}));
// Render the authoritative English copy so the assertions read naturally.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

const noneInstalled = {
  slackInstalled: false,
  slackTeamId: null,
  slackChannelId: null,
  discordInstalled: false,
  discordApplicationId: null,
  discordChannelId: null,
};

describe('<ConnectorsPanel>', () => {
  it('renders the themed empty state when nothing is installed', () => {
    render(<ConnectorsPanel {...noneInstalled} />);
    expect(screen.getByText('No connectors yet')).toBeTruthy();
    // Docs link present in the empty state.
    expect(screen.getByRole('link', { name: /documentation/i })).toBeTruthy();
  });

  it('reveals the Slack/Discord type picker after clicking Add connector', () => {
    render(<ConnectorsPanel {...noneInstalled} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }));
    expect(screen.getByRole('button', { name: 'Slack' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discord' })).toBeTruthy();
  });

  it('shows the chat-bridge form once a connector type is chosen', () => {
    render(<ConnectorsPanel {...noneInstalled} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slack' }));
    expect(screen.getByTestId('chat-bridge-form')).toBeTruthy();
  });

  it('lists an installed connector instead of the empty state', () => {
    render(<ConnectorsPanel {...noneInstalled} slackInstalled slackTeamId="T123" />);
    expect(screen.queryByText('No connectors yet')).toBeNull();
    expect(screen.getByText('Slack')).toBeTruthy();
  });
});
