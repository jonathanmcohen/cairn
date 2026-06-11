import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * v0.9.0 G5 P30 — registered remote Cairn instances a workspace federates
 * search queries to. The fan-out layer (`src/lib/search/peer-fanout.ts`) picks
 * up every row with `enabled=true` and POSTs an HMAC-signed envelope to
 * `${base_url}/api/search/federated/peer`. The inbound route on the receiving
 * side matches the request's signature against this same table to identify
 * the caller.
 *
 * NOTE on `shared_secret_hash` (v0.10.0 G1): the column name promises hashing,
 * but the HMAC protocol needs the raw key at verify/sign time, so one-way
 * hashing is impossible. Instead the secret is ENCRYPTED AT REST: when the
 * operator sets `CAIRN_PEER_SECRET_KEY`, the column holds an AES-256-GCM
 * `enc-v1:` envelope (src/lib/search/peer-secret.ts) and `secret_format` is
 * 'enc-v1'. Raw storage (`secret_format` 'raw') survives only as the legacy /
 * keyless mode: rows written before the key was set are lazily re-encrypted
 * after their first successful verify, and a deployment that never sets the
 * key keeps raw-at-rest behavior with a once-per-process operator warning.
 */
export const peerInstances = pgTable(
  'peer_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    sharedSecretHash: text('shared_secret_hash').notNull(),
    /** 'raw' (legacy/keyless) | 'enc-v1' (AES-256-GCM envelope) — see header. */
    secretFormat: text('secret_format').notNull().default('raw'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspaceName: uniqueIndex('peer_instances_workspace_name_uq').on(t.workspaceId, t.name),
    enabledByWorkspace: index('peer_instances_enabled_idx')
      .on(t.workspaceId)
      .where(sql`enabled = true`),
  }),
);

export type PeerInstance = typeof peerInstances.$inferSelect;
export type NewPeerInstance = typeof peerInstances.$inferInsert;
