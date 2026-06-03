// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatOauthButtons } from '@/app/(app)/settings/admin/chat-bridge/chat-oauth-buttons';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

function wrap(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" messages={en}>
      {ui}
    </I18nProvider>,
  );
}

describe('ChatOauthButtons', () => {
  afterEach(cleanup);

  it('renders OAuth install links to the start routes', () => {
    wrap(
      <ChatOauthButtons
        slackOauthInstalled={false}
        slackTeam={null}
        discordOauthInstalled={false}
        discordTeam={null}
      />,
    );
    const slack = screen.getByRole('link', { name: 'Add to Slack' });
    const discord = screen.getByRole('link', { name: 'Add to Discord' });
    expect(slack.getAttribute('href')).toBe('/api/admin/chat-bridge/oauth/slack/start');
    expect(discord.getAttribute('href')).toBe('/api/admin/chat-bridge/oauth/discord/start');
  });

  it('shows the connected-team status when installed', () => {
    wrap(
      <ChatOauthButtons
        slackOauthInstalled={true}
        slackTeam="T42"
        discordOauthInstalled={false}
        discordTeam={null}
      />,
    );
    expect(screen.getByText('Slack connected via OAuth (team T42).')).toBeTruthy();
  });
});
