import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { encryptPeerSecret } from '@/lib/search/peer-secret';

type Db = PostgresJsDatabase<typeof schema>;

/** Peer row safe to return to the admin UI — never includes the shared secret. */
export type PeerSummary = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export async function listPeers(db: Db, workspaceId: string): Promise<PeerSummary[]> {
  const rows = await db
    .select({
      id: schema.peerInstances.id,
      name: schema.peerInstances.name,
      baseUrl: schema.peerInstances.baseUrl,
      enabled: schema.peerInstances.enabled,
      lastSyncedAt: schema.peerInstances.lastSyncedAt,
      lastError: schema.peerInstances.lastError,
      createdAt: schema.peerInstances.createdAt,
    })
    .from(schema.peerInstances)
    .where(eq(schema.peerInstances.workspaceId, workspaceId))
    .orderBy(desc(schema.peerInstances.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    baseUrl: r.baseUrl,
    enabled: r.enabled,
    lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createPeer(
  db: Db,
  input: {
    workspaceId: string;
    actorUserId: string;
    name: string;
    baseUrl: string;
    sharedSecret: string;
  },
): Promise<PeerSummary> {
  // v0.10.0 G1 — encrypt-at-rest when the operator key is set. HMAC needs the
  // raw key at verify/sign time, so hashing is impossible (see the schema
  // header); without CAIRN_PEER_SECRET_KEY we keep the legacy raw storage.
  // Read process.env directly (NOT the cached env()) — the house pattern for
  // optional secrets, and what lets tests toggle the key per-case.
  const envKey = process.env.CAIRN_PEER_SECRET_KEY;
  const [row] = await db
    .insert(schema.peerInstances)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      baseUrl: input.baseUrl,
      sharedSecretHash: envKey
        ? await encryptPeerSecret(input.sharedSecret, envKey)
        : input.sharedSecret,
      secretFormat: envKey ? 'enc-v1' : 'raw',
      enabled: false,
    })
    .returning();
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'federation.peer_created',
    targetType: 'peer_instance',
    targetId: row!.id,
    metadata: { name: input.name, baseUrl: input.baseUrl },
  });
  return {
    id: row!.id,
    name: row!.name,
    baseUrl: row!.baseUrl,
    enabled: row!.enabled,
    lastSyncedAt: row!.lastSyncedAt ? row!.lastSyncedAt.toISOString() : null,
    lastError: row!.lastError,
    createdAt: row!.createdAt.toISOString(),
  };
}

export async function setPeerEnabled(
  db: Db,
  input: { workspaceId: string; actorUserId: string; peerId: string; enabled: boolean },
): Promise<boolean> {
  const updated = await db
    .update(schema.peerInstances)
    .set({ enabled: input.enabled })
    .where(
      and(
        eq(schema.peerInstances.id, input.peerId),
        eq(schema.peerInstances.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: schema.peerInstances.id });
  if (updated.length === 0) return false;
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.enabled ? 'federation.peer_enabled' : 'federation.peer_disabled',
    targetType: 'peer_instance',
    targetId: input.peerId,
    metadata: {},
  });
  return true;
}

export async function deletePeer(
  db: Db,
  input: { workspaceId: string; actorUserId: string; peerId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(schema.peerInstances)
    .where(
      and(
        eq(schema.peerInstances.id, input.peerId),
        eq(schema.peerInstances.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: schema.peerInstances.id });
  if (deleted.length === 0) return false;
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'federation.peer_deleted',
    targetType: 'peer_instance',
    targetId: input.peerId,
    metadata: {},
  });
  return true;
}
