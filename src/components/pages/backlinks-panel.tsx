'use client';

import { Link2, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type LinkKind = 'link' | 'mention' | 'embed';

type Backlink = { sourcePageId: string; kind: LinkKind };
// v0.6 P10 backlinks-route shape — kept for backwards-compat decoding.
type BareUnlinkedMention = { id: string; title: string };
// v0.8 P18 unlinked-mentions route shape — adds a ts_headline snippet.
type UnlinkedMention = { id: string; title: string; snippet: string };

type BacklinksResponse = {
  backlinks: Backlink[];
  unlinkedMentions: BareUnlinkedMention[];
};

type UnlinkedMentionsResponse = { mentions: UnlinkedMention[] };

type BacklinksPanelProps = {
  pageId: string;
  open: boolean;
  onClose: () => void;
};

const KIND_LABEL: Record<LinkKind, string> = {
  link: 'Link',
  mention: 'Mention',
  embed: 'Embed',
};

function pageHref(id: string): Route {
  return `/pages/${id}` as Route;
}

export function BacklinksPanel({ pageId, open, onClose }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedMention[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    // Fetch both endpoints in parallel: the v0.6 P10 backlinks route gives
    // us linked references; the v0.8 P18 unlinked-mentions route adds the
    // ts_headline snippet for each unlinked mention. The backlinks route
    // still returns `unlinkedMentions` (without snippets) — we ignore that
    // shape here and prefer the richer v0.8 payload.
    const [linkedRes, unlinkedRes] = await Promise.all([
      fetch(`/api/pages/${pageId}/backlinks`),
      fetch(`/api/pages/${pageId}/unlinked-mentions`),
    ]);
    if (!linkedRes.ok || !unlinkedRes.ok) {
      setError('Failed to load backlinks');
      return;
    }
    const linkedData = (await linkedRes.json()) as BacklinksResponse;
    const unlinkedData = (await unlinkedRes.json()) as UnlinkedMentionsResponse;
    setBacklinks(linkedData.backlinks);
    setUnlinked(unlinkedData.mentions);
    setError(null);
  }, [pageId]);

  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  if (!open) return null;

  return (
    <aside className="bg-background flex h-full w-80 flex-col border-l">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-medium">Backlinks</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {error && <p className="text-destructive text-xs">{error}</p>}

        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Linked references
          </h3>
          {backlinks.length === 0 ? (
            <p className="text-muted-foreground text-xs">No linked references yet.</p>
          ) : (
            <ul className="space-y-1">
              {backlinks.map((b) => (
                <li
                  key={`${b.sourcePageId}:${b.kind}`}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <Link
                    href={pageHref(b.sourcePageId)}
                    className="text-primary truncate underline hover:no-underline"
                  >
                    {b.sourcePageId.slice(0, 8)}
                  </Link>
                  <span className="text-muted-foreground shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                    {KIND_LABEL[b.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Unlinked mentions
          </h3>
          {unlinked.length === 0 ? (
            <p className="text-muted-foreground text-xs">No unlinked mentions.</p>
          ) : (
            <ul className="space-y-1">
              {unlinked.map((m) => (
                <li key={m.id} className="space-y-1 rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={pageHref(m.id)}
                      className="text-primary truncate underline hover:no-underline"
                    >
                      {m.title || 'Untitled'}
                    </Link>
                    <span
                      className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[10px]"
                      title="Mentions this page in text"
                    >
                      <Link2 className="h-3 w-3" />
                      Link
                    </span>
                  </div>
                  {m.snippet && (
                    <p
                      className="text-muted-foreground text-xs"
                      // The snippet is `ts_headline` output over the mentioning
                      // page's body — that page is in the caller's workspace
                      // and the requirePageAccess(viewer) gate on the route
                      // already confirmed access, so rendering Postgres-
                      // generated `<b>` emphasis is safe.
                      //
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ts_headline output
                      dangerouslySetInnerHTML={{ __html: m.snippet }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
