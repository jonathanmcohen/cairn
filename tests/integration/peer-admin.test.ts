import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPeer, deletePeer, listPeers, setPeerEnabled } from '@/lib/search/peer-admin';
import { decryptPeerSecret, isEncryptedSecret } from '@/lib/search/peer-secret';
import { startPostgres, stopPostgres } from '../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let wsA: string;
let wsB: string;
let actor: string;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE audit_log, peer_instances, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'admin@example.com', name: 'Admin', passwordHash: 'x' })
    .returning();
  actor = u!.id;
  const [a] = await db.insert(schema.workspaces).values({ name: 'A', slug: 'a' }).returning();
  const [b] = await db.insert(schema.workspaces).values({ name: 'B', slug: 'b' }).returning();
  wsA = a!.id;
  wsB = b!.id;
  delete process.env.CAIRN_PEER_SECRET_KEY;
});

afterEach(() => {
  delete process.env.CAIRN_PEER_SECRET_KEY;
});

describe('peer-admin lib', () => {
  it('creates a peer (disabled by default) and lists it scoped to the workspace', async () => {
    const peer = await createPeer(db, {
      workspaceId: wsA,
      actorUserId: actor,
      name: 'partner',
      baseUrl: 'https://partner.example.com',
      sharedSecret: 'super-secret-value',
    });
    expect(peer.enabled).toBe(false);

    const listed = await listPeers(db, wsA);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('partner');
    // The shared secret MUST NOT be returned to the admin UI.
    expect(JSON.stringify(listed)).not.toContain('super-secret-value');

    // Workspace scoping: wsB sees nothing.
    expect(await listPeers(db, wsB)).toHaveLength(0);
  });

  it('toggles enabled and deletes only within the owning workspace', async () => {
    const peer = await createPeer(db, {
      workspaceId: wsA,
      actorUserId: actor,
      name: 'partner',
      baseUrl: 'https://partner.example.com',
      sharedSecret: 's3cr3t-value-1234',
    });

    await setPeerEnabled(db, {
      workspaceId: wsA,
      actorUserId: actor,
      peerId: peer.id,
      enabled: true,
    });
    expect((await listPeers(db, wsA))[0]?.enabled).toBe(true);

    // A cross-workspace delete attempt is a no-op (scoping guard).
    const crossDeleted = await deletePeer(db, {
      workspaceId: wsB,
      actorUserId: actor,
      peerId: peer.id,
    });
    expect(crossDeleted).toBe(false);
    expect(await listPeers(db, wsA)).toHaveLength(1);

    const deleted = await deletePeer(db, { workspaceId: wsA, actorUserId: actor, peerId: peer.id });
    expect(deleted).toBe(true);
    expect(await listPeers(db, wsA)).toHaveLength(0);
  });

  // v0.10.0 G1 — pairing writes the secret encrypted when the env key is set.
  it('createPeer with CAIRN_PEER_SECRET_KEY set never stores the raw secret', async () => {
    const envKey = 'peer-admin-test-key-0123456789ab';
    process.env.CAIRN_PEER_SECRET_KEY = envKey;
    const rawSecret = 'pairing-secret-value-abcdef';
    await createPeer(db, {
      workspaceId: wsA,
      actorUserId: actor,
      name: 'enc-partner',
      baseUrl: 'https://partner.example.com',
      sharedSecret: rawSecret,
    });
    const rows = await sql`
      select shared_secret_hash, secret_format from peer_instances where name = 'enc-partner'
    `;
    const row = rows[0] as { shared_secret_hash: string; secret_format: string };
    expect(row.secret_format).toBe('enc-v1');
    expect(isEncryptedSecret(row.shared_secret_hash)).toBe(true);
    expect(row.shared_secret_hash).not.toContain(rawSecret);
    await expect(decryptPeerSecret(row.shared_secret_hash, envKey)).resolves.toBe(rawSecret);
  });

  it('createPeer without the env key keeps legacy raw storage (secret_format raw)', async () => {
    await createPeer(db, {
      workspaceId: wsA,
      actorUserId: actor,
      name: 'raw-partner',
      baseUrl: 'https://partner.example.com',
      sharedSecret: 'legacy-raw-secret-1234',
    });
    const rows = await sql`
      select shared_secret_hash, secret_format from peer_instances where name = 'raw-partner'
    `;
    const row = rows[0] as { shared_secret_hash: string; secret_format: string };
    expect(row.secret_format).toBe('raw');
    expect(row.shared_secret_hash).toBe('legacy-raw-secret-1234');
  });
});
