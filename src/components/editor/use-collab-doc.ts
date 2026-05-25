'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useMemo, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { recordDocAccess } from '@/lib/offline/doc-index';
import { evictUntilUnderCap } from '@/lib/offline/evict';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type UseCollabDoc = {
  ydoc: Y.Doc;
  provider: HocuspocusProvider | null;
  status: CollabStatus;
  offlineReady: boolean;
};

// NEXT_PUBLIC_* vars are inlined at build time by Next.js, so reading
// process.env.NEXT_PUBLIC_CAIRN_OFFLINE_DOC_LIMIT_MB directly works on the
// client. We do NOT call `env()` here — the server-side schema validates
// DATABASE_URL/AUTH_SECRET which are not in the client bundle.
function offlineCapBytes(): number {
  const raw = process.env.NEXT_PUBLIC_CAIRN_OFFLINE_DOC_LIMIT_MB;
  const mb = raw ? Number.parseInt(raw, 10) : 256;
  const capMb = Number.isFinite(mb) && mb > 0 ? mb : 256;
  return capMb * 1024 * 1024;
}

export function useCollabDoc(workspaceId: string, pageId: string): UseCollabDoc {
  // One Y.Doc per page for the component's lifetime.
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [offlineReady, setOfflineReady] = useState(false);

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

  // Persist this doc to IndexedDB so a recently-viewed page reads offline and
  // offline edits CRDT-merge on reconnect. Same ydoc is bound to both the
  // IndexeddbPersistence and the HocuspocusProvider — Yjs handles convergence.
  // Not gated on the token/provider: offline read must work without network.
  // Doc-name uses `${workspaceId}:${pageId}` so eviction (./offline/evict.ts)
  // can target the underlying IDB database by the same name.
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    const persistence = new IndexeddbPersistence(`${workspaceId}:${pageId}`, ydoc);
    const onSynced = () => {
      setOfflineReady(true);
      // After local state is loaded, record access + run a size-capped
      // eviction sweep. Sized via the current Yjs doc's encoded byte length —
      // refreshed on every page open since the doc grows as the user edits.
      const sizeBytes = Y.encodeStateAsUpdate(ydoc).byteLength;
      void recordDocAccess({ workspaceId, pageId, sizeBytes }).then(() =>
        evictUntilUnderCap({ workspaceId, capBytes: offlineCapBytes() }),
      );
    };
    persistence.on('synced', onSynced);

    return () => {
      setOfflineReady(false);
      persistence.off('synced', onSynced);
      // Do NOT clearData() — persisted data must survive for the next open.
      void persistence.destroy();
    };
  }, [workspaceId, pageId, ydoc]);

  return { ydoc, provider, status, offlineReady };
}
