'use client';

/**
 * v0.9.0 G7 P36 — chat-bridge admin form (Client Component).
 *
 * Two independent panels — Slack and Discord — each with a paste-the-URL flow.
 * Submits to `/api/admin/chat-bridge` (POST upsert, DELETE remove). Per the
 * CLAUDE.md "No function props from RSC to Client" rule, the parent passes
 * only string + boolean props.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Platform = 'slack' | 'discord';

export type ChatBridgeFormProps = {
  slackInstalled: boolean;
  slackTeamId: string | null;
  slackChannelId: string | null;
  discordInstalled: boolean;
  discordApplicationId: string | null;
  discordChannelId: string | null;
};

async function postInstall(
  platform: Platform,
  body: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/admin/chat-bridge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text || res.statusText };
  }
  return { ok: true };
}

async function deleteInstall(platform: Platform): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/admin/chat-bridge', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text || res.statusText };
  }
  return { ok: true };
}

export function ChatBridgeForm(props: ChatBridgeFormProps) {
  return (
    <div className="space-y-8">
      <SlackPanel
        installed={props.slackInstalled}
        teamId={props.slackTeamId}
        channelId={props.slackChannelId}
      />
      <DiscordPanel
        installed={props.discordInstalled}
        applicationId={props.discordApplicationId}
        channelId={props.discordChannelId}
      />
    </div>
  );
}

function SlackPanel({
  installed,
  teamId,
  channelId,
}: {
  installed: boolean;
  teamId: string | null;
  channelId: string | null;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <section className="rounded-lg border p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Slack</h2>
          <p className="text-sm text-muted-foreground">
            {installed
              ? `Connected to team ${teamId ?? '(unknown)'}${channelId ? ` · channel ${channelId}` : ''}.`
              : 'Not connected.'}
          </p>
        </div>
        {installed ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const r = await deleteInstall('slack');
                setStatus(r.ok ? 'Disconnected.' : `Error: ${r.error}`);
                if (r.ok) window.location.reload();
              });
            }}
          >
            Disconnect
          </Button>
        ) : null}
      </header>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const r = await postInstall('slack', {
              webhookUrl: String(form.get('webhookUrl') ?? ''),
              signingSecret: String(form.get('signingSecret') ?? ''),
              teamId: String(form.get('teamId') ?? ''),
              channelId: String(form.get('channelId') ?? ''),
            });
            setStatus(r.ok ? 'Saved.' : `Error: ${r.error}`);
            if (r.ok) window.location.reload();
          });
        }}
      >
        <div>
          <Label htmlFor="slack-url">Incoming webhook URL</Label>
          <Input id="slack-url" name="webhookUrl" type="url" required />
        </div>
        <div>
          <Label htmlFor="slack-signing">Signing secret</Label>
          <Input id="slack-signing" name="signingSecret" type="password" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="slack-team">Team ID</Label>
            <Input id="slack-team" name="teamId" />
          </div>
          <div>
            <Label htmlFor="slack-channel">Channel ID</Label>
            <Input id="slack-channel" name="channelId" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : installed ? 'Update' : 'Connect Slack'}
          </Button>
          {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
        </div>
      </form>
    </section>
  );
}

function DiscordPanel({
  installed,
  applicationId,
  channelId,
}: {
  installed: boolean;
  applicationId: string | null;
  channelId: string | null;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <section className="rounded-lg border p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Discord</h2>
          <p className="text-sm text-muted-foreground">
            {installed
              ? `Connected to application ${applicationId ?? '(unknown)'}${channelId ? ` · channel ${channelId}` : ''}.`
              : 'Not connected.'}
          </p>
        </div>
        {installed ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const r = await deleteInstall('discord');
                setStatus(r.ok ? 'Disconnected.' : `Error: ${r.error}`);
                if (r.ok) window.location.reload();
              });
            }}
          >
            Disconnect
          </Button>
        ) : null}
      </header>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const r = await postInstall('discord', {
              webhookUrl: String(form.get('webhookUrl') ?? ''),
              publicKey: String(form.get('publicKey') ?? ''),
              applicationId: String(form.get('applicationId') ?? ''),
              channelId: String(form.get('channelId') ?? ''),
            });
            setStatus(r.ok ? 'Saved.' : `Error: ${r.error}`);
            if (r.ok) window.location.reload();
          });
        }}
      >
        <div>
          <Label htmlFor="discord-url">Webhook URL (append ?wait=true for posted-log)</Label>
          <Input id="discord-url" name="webhookUrl" type="url" required />
        </div>
        <div>
          <Label htmlFor="discord-pub">Application public key (hex)</Label>
          <Input id="discord-pub" name="publicKey" type="password" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="discord-app">Application ID</Label>
            <Input id="discord-app" name="applicationId" />
          </div>
          <div>
            <Label htmlFor="discord-channel">Channel ID</Label>
            <Input id="discord-channel" name="channelId" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : installed ? 'Update' : 'Connect Discord'}
          </Button>
          {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
        </div>
      </form>
    </section>
  );
}
