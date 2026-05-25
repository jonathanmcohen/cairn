// @vitest-environment jsdom
//
// Offline edit → reconnect → CRDT merge integration smoke.
// Spins:
//   - Testcontainers Postgres (only to mirror prod wiring; the merge contract
//     itself is socket-side between the two clients + the Hocuspocus stub).
//   - One in-process Hocuspocus server on a random localhost port.
//   - Two HocuspocusProvider clients sharing the same doc name
//     `${workspaceId}:${pageId}` (the convention v0.6 P13 + v0.8 P1 use).
//   - One IndexeddbPersistence per client (fake-indexeddb-backed in jsdom).
//
// The plan-of-record (spec §2.2) is "the existing HocuspocusProvider auto-
// reconnects + Yjs CRDT merges with the server doc on rejoin". This smoke
// proves that contract end-to-end.
//
// Determinism: `vi.useFakeTimers({ shouldAdvanceTime: true })` keeps Yjs's
// internal timers (and any provider backoff) under our control without
// starving the WebSocket I/O — the `shouldAdvanceTime` flag lets real-time
// ticks run for actual socket events while letting the test fast-forward
// scheduled reconnect backoff.

import 'fake-indexeddb/auto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { Server } from '@hocuspocus/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { startPostgres, stopPostgres } from '../helpers/db';

const WORKSPACE_ID = 'w-test-1';
const PAGE_ID = 'p-test-1';
const DOC_NAME = `${WORKSPACE_ID}:${PAGE_ID}`;

let hocuspocus: Server;
let port: number;

beforeAll(async () => {
  // Mirror prod wiring: Postgres is up even though this smoke doesn't read it.
  // Keeps the harness identical to the v0.7 collab/server.ts shape so future
  // tests (e.g. materialize-on-flush) can extend without re-spinning.
  await startPostgres();

  // Random localhost port via Node http.Server.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  port = (probe.address() as AddressInfo).port;
  probe.close();

  hocuspocus = new Server({
    port,
    address: '127.0.0.1',
    // No auth, no Database extension — the merge contract is purely between
    // the two in-memory client docs + Hocuspocus's in-memory shared doc.
    quiet: true,
  });
  await hocuspocus.listen();
});

afterAll(async () => {
  await hocuspocus?.destroy();
  await stopPostgres();
});

beforeEach(() => {
  // shouldAdvanceTime keeps the underlying ws I/O ticking real time while we
  // still get to fast-forward provider reconnect backoff via advanceTimersByTime.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Construct one client: Y.Doc + IndexedDB persistence + Hocuspocus provider. */
function newClient(label: string): {
  doc: Y.Doc;
  idb: IndexeddbPersistence;
  provider: HocuspocusProvider;
  text: Y.Text;
} {
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(`${DOC_NAME}::${label}`, doc);
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name: DOC_NAME,
    document: doc,
    // No token — server has no auth extension.
    token: 'none',
  });
  const text = doc.getText('default');
  return { doc, idb, provider, text };
}

/** Wait until the provider reports synced; bounded so a missing handshake fails fast. */
async function waitSynced(provider: HocuspocusProvider, label: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (provider.synced) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`provider ${label} did not sync within ${timeoutMs}ms`);
}

describe('offline edit → reconnect → CRDT merge', () => {
  it.skip('skeleton — assertions land in Task 2', () => {
    expect(true).toBe(true);
  });
});
