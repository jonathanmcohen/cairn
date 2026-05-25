'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Preview = {
  title: string;
  icon: string | null;
  firstParagraph: string;
};

type State = { kind: 'loading' } | { kind: 'ok'; preview: Preview } | { kind: 'error' };

/**
 * Small hover popover that fetches `/api/pages/[pageId]/preview` and renders
 * the linked page's title + icon + first paragraph + an "Open page" link.
 * Mounted into the editor by `pageLinkHoverPlugin` (see page-link-extension.ts)
 * via the shared tippy.js instance.
 */
export function PageLinkPopover({ pageId }: { pageId: string }): React.ReactNode {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/pages/${pageId}/preview`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`preview: ${res.status}`);
        const preview = (await res.json()) as Preview;
        if (!cancelled) setState({ kind: 'ok', preview });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  return (
    <div
      role="tooltip"
      className="bg-popover text-popover-foreground max-w-sm rounded-md border p-3 text-sm shadow-md"
    >
      {state.kind === 'loading' && <p className="text-muted-foreground">Loading preview…</p>}
      {state.kind === 'error' && <p className="text-muted-foreground">Couldn't load preview.</p>}
      {state.kind === 'ok' && (
        <>
          <p className="mb-1 font-medium">
            {state.preview.icon && (
              <span aria-hidden className="mr-1">
                {state.preview.icon}
              </span>
            )}
            {state.preview.title}
          </p>
          {state.preview.firstParagraph && (
            <p className="text-muted-foreground mb-2 line-clamp-3">
              {state.preview.firstParagraph}
            </p>
          )}
          <Link
            href={`/pages/${pageId}` as Route}
            className="text-primary underline-offset-4 hover:underline"
          >
            Open page
          </Link>
        </>
      )}
    </div>
  );
}
