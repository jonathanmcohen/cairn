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
 * MVP NOTE on `shared_secret_hash`: the column name promises hashing
 * (argon2id/bcrypt) but the v0.9 implementation stores the raw shared secret
 * so the HMAC verifier can recompute the signature. A v1.0 hardening plan
 * should switch to hashed storage + a key-derivation function. See the
 * inbound route comment for details.
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
