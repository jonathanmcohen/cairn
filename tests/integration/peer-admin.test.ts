import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPeer, deletePeer, listPeers, setPeerEnabled } from '@/lib/search/peer-admin';
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
});
