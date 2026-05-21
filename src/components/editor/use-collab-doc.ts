'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type UseCollabDoc = {
  ydoc: Y.Doc;
  provider: HocuspocusProvider | null;
  status: CollabStatus;
};

export function useCollabDoc(pageId: string): UseCollabDoc {
  // One Y.Doc per page for the component's lifetime.
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');

  useEffect(() => {
    let cancelled = false;
    let p: HocuspocusProvider | null = null;

    void (async () => {
      try {
        const res = await fetch(`/api/collab/token?pageId=${encodeURIComponent(pageId)}`);
        if (!res.ok) {
          if (!cancelled) setStatus('error');
          return;
        }
        const { token, collabUrl } = (await res.json()) as { token: string; collabUrl: string };
        if (cancelled) return;

        p = new HocuspocusProvider({
          url: collabUrl,
          name: pageId, // doc name = pageId
          token,
          document: ydoc,
          onStatus: ({ status: s }) => {
            if (cancelled) return;
            setStatus(s === 'connected' ? 'connected' : 'connecting');
          },
          onDisconnect: () => !cancelled && setStatus('disconnected'),
        });
        if (!cancelled) setProvider(p);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      p?.destroy();
      ydoc.destroy();
    };
  }, [pageId, ydoc]);

  return { ydoc, provider, status };
}
