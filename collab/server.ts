import { Database } from '@hocuspocus/extension-database';
import { Server } from '@hocuspocus/server';
import postgres from 'postgres';
import * as Y from 'yjs';
import { authorizeCollab } from '../src/lib/collab/authorize.js';
import { yjsStateToProseDoc } from '../src/lib/collab/materialize.js';
import { incCollabDocUpdate, setCollabConnections } from '../src/lib/observability/metrics.js';
import { createMaterializeScheduler } from './materialize-scheduler.js';

const DATABASE_URL = process.env.DATABASE_URL;
const AUTH_SECRET = process.env.AUTH_SECRET;
const PORT = Number(process.env.COLLAB_PORT ?? 1234);

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!AUTH_SECRET) throw new Error('AUTH_SECRET is required');

const sql = postgres(DATABASE_URL);
const secret = AUTH_SECRET;

// documentName (page id) -> live Y.Doc, kept current by the Hocuspocus hooks so
// the disconnect-flush can materialize the final state without a live socket.
const docs = new Map<string, Y.Doc>();

// In-process collab connection count. The Next-app /metrics endpoint scrapes a
// different process's registry, so this counter lives only in the collab
// process — aggregating across processes is a deployment concern (deferred).
let connectionCount = 0;

/**
 * Encode the live Y.Doc to ProseMirror JSON (fragment 'default', matching the
 * client seed + materialize.ts) and write it to pages.content. The existing
 * pages_sync_search_columns trigger refreshes content_text/content_tsv — we
 * never touch those columns directly.
 */
async function materialize(pageId: string) {
  const ydoc = docs.get(pageId);
  if (!ydoc) return;
  const state = Y.encodeStateAsUpdate(ydoc);
  const prose = yjsStateToProseDoc(state);
  // sql.json binds the doc as a jsonb OBJECT. Passing JSON.stringify(prose) with
  // a ::jsonb cast would store a jsonb STRING scalar, so the FTS trigger's
  // jsonb_path_query('$.**.text') finds nothing and content_text stays empty.
  await sql`
    UPDATE pages
    SET content = ${sql.json(prose as postgres.JSONValue)}, updated_at = now()
    WHERE id = ${pageId}::uuid
  `;
}

// Design (a) per the plan: Hocuspocus already debounces onStoreDocument, so we
// materialize straight from that hook. The scheduler is used ONLY for the
// last-disconnect flush, guaranteeing the final edits are never lost.
const scheduler = createMaterializeScheduler({
  debounceMs: 2000,
  flush: materialize,
});

const server = new Server({
  port: PORT,
  // documentName is the page id (uuid).
  async onAuthenticate({ token, documentName }) {
    const result = authorizeCollab(token, documentName, secret);
    if (!result.ok) {
      // Throwing rejects the connection.
      throw new Error('Unauthorized');
    }
    // Bump connection metric AFTER auth passes so rejected attempts don't inflate
    // the gauge. Decrement happens in onDisconnect.
    connectionCount += 1;
    setCollabConnections(connectionCount);
    // Expose claims to later hooks (used in Plan 2 for materialize attribution).
    return { user: { id: result.userId, role: result.role } };
  },
  // Hocuspocus debounces this hook; materialize the merged doc to pages.content.
  async onStoreDocument({ documentName, document }) {
    docs.set(documentName, document);
    await materialize(documentName);
    incCollabDocUpdate(1);
  },
  // On the last client leaving, flush immediately so trailing edits aren't lost.
  async onDisconnect({ documentName, clientsCount }) {
    connectionCount = Math.max(0, connectionCount - 1);
    setCollabConnections(connectionCount);
    if (clientsCount === 0) {
      scheduler.onLastDisconnect(documentName);
    }
  },
  extensions: [
    new Database({
      async fetch({ documentName }) {
        const rows = await sql<{ state: Buffer }[]>`
          SELECT state FROM page_yjs WHERE page_id = ${documentName}::uuid LIMIT 1
        `;
        return rows[0]?.state ?? null;
      },
      async store({ documentName, state }) {
        const buf = Buffer.from(state);
        await sql`
          INSERT INTO page_yjs (page_id, state, updated_at)
          VALUES (${documentName}::uuid, ${buf}, now())
          ON CONFLICT (page_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
        `;
      },
    }),
  ],
});

server.listen();
// biome-ignore lint/suspicious/noConsole: intentional startup log for the standalone service
console.log(`cairn-collab listening on ws://0.0.0.0:${PORT}`);
