'use client';

/**
 * v0.9.0 G7 P37 — Client Component for channel-link CRUD.
 *
 * Renders the existing-links table + an add-new form. All mutations POST or
 * DELETE to `/api/admin/chat-bridge/channels`. Per CLAUDE.md "No function
 * props from RSC to Client", the parent only passes plain values.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type LinkRow = {
  id: string;
  channelId: string;
  linkMode: string;
  linkedAt: string;
  pageId: string;
  pageTitle: string;
  installId: string;
  platform: string;
  teamId: string;
};

type Install = { id: string; platform: string; teamId: string };
type PageOpt = { id: string; title: string };

export function ChannelLinksManager(props: {
  links: LinkRow[];
  installs: Install[];
  pages: PageOpt[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [installId, setInstallId] = useState<string>(props.installs[0]?.id ?? '');
  const [channelId, setChannelId] = useState('');
  const [pageId, setPageId] = useState<string>(props.pages[0]?.id ?? '');
  const [linkMode, setLinkMode] = useState<'notify' | 'sync'>('notify');

  async function submitAdd(): Promise<void> {
    setError(null);
    const res = await fetch('/api/admin/chat-bridge/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installId, channelId, pageId, linkMode }),
    });
    if (!res.ok) {
      setError(`Add failed: ${res.status} ${await res.text().catch(() => '')}`);
      return;
    }
    setChannelId('');
    startTransition(() => router.refresh());
  }

  async function submitDelete(id: string): Promise<void> {
    setError(null);
    const res = await fetch('/api/admin/chat-bridge/channels', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      setError(`Remove failed: ${res.status}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className="space-y-6">
      {props.installs.length === 0 ? (
        <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          No chat-bridge installs yet. Configure Slack or Discord on the main{' '}
          <a className="underline" href="/admin/chat-bridge">
            chat bridge
          </a>{' '}
          page first.
        </p>
      ) : (
        <fieldset className="space-y-3 rounded border p-4">
          <legend className="text-sm font-medium">Add channel link</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cl-install">Install</Label>
              <select
                id="cl-install"
                className="mt-1 h-11 w-full rounded border bg-background px-3 text-sm"
                value={installId}
                onChange={(e) => setInstallId(e.target.value)}
                aria-label="Chat bridge install"
              >
                {props.installs.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.platform} — {i.teamId}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="cl-channel">Channel id</Label>
              <Input
                id="cl-channel"
                className="mt-1 h-11"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="C0123ABC or 1100000000000000000"
              />
            </div>
            <div>
              <Label htmlFor="cl-page">Page</Label>
              <select
                id="cl-page"
                className="mt-1 h-11 w-full rounded border bg-background px-3 text-sm"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                aria-label="Target page"
              >
                {props.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="cl-mode">Mode</Label>
              <select
                id="cl-mode"
                className="mt-1 h-11 w-full rounded border bg-background px-3 text-sm"
                value={linkMode}
                onChange={(e) => setLinkMode(e.target.value as 'notify' | 'sync')}
                aria-label="Link mode"
              >
                <option value="notify">Notify (outbound only)</option>
                <option value="sync">Sync (bidirectional)</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              onClick={submitAdd}
              disabled={isPending || !installId || !channelId || !pageId}
              className="h-11"
            >
              Add link
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </fieldset>
      )}

      <div>
        <h2 className="mb-2 text-base font-medium">Existing links</h2>
        {props.links.length === 0 ? (
          <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            No channel links yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-3">Platform</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3">Page</th>
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {props.links.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    {l.platform} ({l.teamId})
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{l.channelId}</td>
                  <td className="py-2 pr-3">{l.pageTitle}</td>
                  <td className="py-2 pr-3">{l.linkMode}</td>
                  <td className="py-2 pr-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11"
                      onClick={() => submitDelete(l.id)}
                      disabled={isPending}
                      aria-label={`Remove link for channel ${l.channelId}`}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
