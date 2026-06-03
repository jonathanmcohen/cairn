'use client';

import { Plug } from 'lucide-react';
import { useState } from 'react';
import { ChatBridgeForm } from '@/app/(app)/settings/admin/chat-bridge/chat-bridge-form';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

type Platform = 'slack' | 'discord';

const CONNECTOR_DOCS_URL = 'https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md';

export type ConnectorsPanelProps = {
  slackInstalled: boolean;
  slackTeamId: string | null;
  slackChannelId: string | null;
  discordInstalled: boolean;
  discordApplicationId: string | null;
  discordChannelId: string | null;
};

export function ConnectorsPanel(props: ConnectorsPanelProps) {
  const t = useT();
  // 'closed' = browsing; 'picker' = choosing a type; a Platform = configuring it.
  const [stage, setStage] = useState<'closed' | 'picker' | Platform>('closed');
  const anyInstalled = props.slackInstalled || props.discordInstalled;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('connectors.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('connectors.subtitle')}</p>
        </div>
        {/* Primary CTA matches the "Create key" button (default variant, 44px). */}
        <Button onClick={() => setStage('picker')} className="min-h-11">
          {t('connectors.add')}
        </Button>
      </header>

      {stage === 'picker' ? (
        <div className="rounded-md border p-4">
          <p className="mb-3 text-sm font-medium">{t('connectors.chooseType')}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" className="min-h-11" onClick={() => setStage('slack')}>
              {t('connectors.slack')}
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => setStage('discord')}>
              {t('connectors.discord')}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setStage('closed')}>
              {t('connectors.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 'slack' || stage === 'discord' ? (
        <div className="rounded-md border p-4">
          <ChatBridgeForm
            slackInstalled={props.slackInstalled}
            slackTeamId={props.slackTeamId}
            slackChannelId={props.slackChannelId}
            discordInstalled={props.discordInstalled}
            discordApplicationId={props.discordApplicationId}
            discordChannelId={props.discordChannelId}
          />
        </div>
      ) : null}

      {anyInstalled ? (
        <ul className="divide-y rounded-md border">
          {props.slackInstalled ? (
            <li className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium">{t('connectors.slack')}</div>
                <div className="text-muted-foreground text-xs">
                  {props.slackTeamId
                    ? t('connectors.team', { id: props.slackTeamId })
                    : t('connectors.installed')}
                </div>
              </div>
              <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
                {t('connectors.connected')}
              </span>
            </li>
          ) : null}
          {props.discordInstalled ? (
            <li className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium">{t('connectors.discord')}</div>
                <div className="text-muted-foreground text-xs">
                  {props.discordApplicationId
                    ? t('connectors.app', { id: props.discordApplicationId })
                    : t('connectors.installed')}
                </div>
              </div>
              <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
                {t('connectors.connected')}
              </span>
            </li>
          ) : null}
        </ul>
      ) : stage === 'closed' ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-10 text-center">
          <Plug aria-hidden="true" className="text-muted-foreground size-8" />
          <div>
            <p className="font-medium">{t('connectors.empty.title')}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('connectors.empty.body')}</p>
          </div>
          <a
            href={CONNECTOR_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline hover:no-underline"
          >
            {t('connectors.empty.docs')}
          </a>
        </div>
      ) : null}
    </div>
  );
}
