'use client';

import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

export type ChatOauthButtonsProps = {
  slackOauthInstalled: boolean;
  slackTeam: string | null;
  discordOauthInstalled: boolean;
  discordTeam: string | null;
};

export function ChatOauthButtons(props: ChatOauthButtonsProps) {
  const t = useT();
  return (
    <section className="rounded-lg border p-6">
      <h2 className="font-semibold text-lg">{t('chatOauth.heading')}</h2>
      <p className="mt-1 mb-4 text-muted-foreground text-sm">{t('chatOauth.description')}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a href="/api/admin/chat-bridge/oauth/slack/start">{t('chatOauth.connectSlack')}</a>
        </Button>
        <Button asChild>
          <a href="/api/admin/chat-bridge/oauth/discord/start">{t('chatOauth.connectDiscord')}</a>
        </Button>
      </div>
      {props.slackOauthInstalled ? (
        <p className="mt-3 text-muted-foreground text-sm">
          {t('chatOauth.installedSlack', { team: props.slackTeam ?? '?' })}
        </p>
      ) : null}
      {props.discordOauthInstalled ? (
        <p className="mt-1 text-muted-foreground text-sm">
          {t('chatOauth.installedDiscord', { team: props.discordTeam ?? '?' })}
        </p>
      ) : null}
    </section>
  );
}
