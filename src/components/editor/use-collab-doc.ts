'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useMemo, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { recordDocAccess } from '@/lib/offline/doc-index';
import { evictUntilUnderCap } from '@/lib/offline/evict';
import {
  type BackoffConfig,
  DEFAULT_COLLAB_BACKOFF,
  scheduleWithBackoff,
  shouldRetryCollab,
} from './collab-backoff';

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
// v0.9.8 G3 (audit item I) — register every collab WebSocket on `window` so an
// operator (and the offline-banner e2e) can observe / force-drop the live
// transport. HocuspocusProvider opens its socket through the configured
// `WebSocketPolyfill`; this subclass is a transparent pass-through that simply
// pushes each instance into `window.__cairnSockets` and prunes it on close. No
// behavioural change to the connection itself — same native WebSocket.
function collabWebSocket(): typeof WebSocket | undefined {
  if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') return undefined;
  const w = window as unknown as { __cairnSockets?: WebSocket[]; WebSocket: typeof WebSocket };
  // Always read the *current* window.WebSocket at construction time so a test
  // that monkey-patches it (to refuse reconnects) is honoured.
  class RegisteredWebSocket extends w.WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const registry = (w.__cairnSockets ??= []);
      registry.push(this as unknown as WebSocket);
      const prune = () => {
        const i = registry.indexOf(this as unknown as WebSocket);
        if (i !== -1) registry.splice(i, 1);
      };
      this.addEventListener('close', prune);
    }
  }
  return RegisteredWebSocket as unknown as typeof WebSocket;
}

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

  // v0.9.8 G3 (audit item I) — resilient connect loop. A token-fetch failure
  // is no longer terminal: we retry the token re-fetch with exponential
  // backoff (base/max caps + jitter) and recreate the HocuspocusProvider after
  // a successful re-fetch. A post-connect `disconnect` also triggers the loop
  // so a dropped socket re-mints a fresh (TTL-bound) token before reconnecting.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let current: HocuspocusProvider | null = null;
    let cancelTimer: (() => void) | null = null;
    const backoff: BackoffConfig = DEFAULT_COLLAB_BACKOFF;

    const scheduleRetry = () => {
      if (!shouldRetryCollab({ kind: 'token-failed', cancelled })) return;
      cancelTimer?.();
      cancelTimer = scheduleWithBackoff(attempt, backoff, () => {
        attempt += 1;
        void connect();
      });
    };

    async function connect(): Promise<void> {
      if (cancelled) return;
      // Drop any prior provider before recreating (avoids two sockets on the
      // same Y.Doc after a reconnect).
      current?.destroy();
      current = null;
      setStatus('connecting');
      try {
        const res = await fetch(`/api/collab/token?pageId=${encodeURIComponent(pageId)}`);
        if (!res.ok) {
          if (!cancelled) setStatus('error');
          scheduleRetry();
          return;
        }
        const { token, collabUrl } = (await res.json()) as { token: string; collabUrl: string };
        if (cancelled) return;

        attempt = 0; // reset backoff on a successful token fetch
        const p = new HocuspocusProvider({
          url: collabUrl,
          name: pageId, // doc name = pageId
          token,
          document: ydoc,
          // Transparent socket-registry wrapper (see collabWebSocket). undefined
          // → Hocuspocus falls back to the global WebSocket (SSR / no window).
          WebSocketPolyfill: collabWebSocket(),
          onStatus: ({ status: s }) => {
            if (cancelled) return;
            setStatus(s === 'connected' ? 'connected' : 'connecting');
          },
          onDisconnect: () => {
            if (cancelled) return;
            setStatus('disconnected');
            // Re-mint a token and recreate the provider with backoff.
            scheduleRetry();
          },
        });
        current = p;
        setProvider(p);
      } catch {
        if (!cancelled) setStatus('error');
        scheduleRetry();
      }
    }

    void connect();

    return () => {
      cancelled = true;
      cancelTimer?.();
      current?.destroy();
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
