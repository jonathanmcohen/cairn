import { Database } from '@hocuspocus/extension-database';
import { Server } from '@hocuspocus/server';
import postgres from 'postgres';
import { authorizeCollab } from '../src/lib/collab/authorize.js';

const DATABASE_URL = process.env.DATABASE_URL;
const AUTH_SECRET = process.env.AUTH_SECRET;
const PORT = Number(process.env.COLLAB_PORT ?? 1234);

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!AUTH_SECRET) throw new Error('AUTH_SECRET is required');

const sql = postgres(DATABASE_URL);
const secret = AUTH_SECRET;

const server = new Server({
  port: PORT,
  // documentName is the page id (uuid).
  async onAuthenticate({ token, documentName }) {
    const result = authorizeCollab(token, documentName, secret);
    if (!result.ok) {
      // Throwing rejects the connection.
      throw new Error('Unauthorized');
    }
    // Expose claims to later hooks (used in Plan 2 for materialize attribution).
    return { user: { id: result.userId, role: result.role } };
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
