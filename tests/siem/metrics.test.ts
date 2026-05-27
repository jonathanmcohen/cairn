/**
 * v0.9.0 G8 P39 — verify `cairn_siem_delivery_total` + the latency histogram
 * carry the expected forwarder_kind + status labels after a dispatch fan-out.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { metricsRegistry, resetMetrics } from '@/lib/observability/metrics';
import { dispatchAuditEvent } from '@/lib/siem/dispatch';
import { startPostgres, stopPostgres } from '../helpers/db';

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});
afterAll(async () => {
  await pg.end();
  await stopPostgres();
});
beforeEach(async () => {
  await pg`TRUNCATE
    siem_delivery_log, siem_forwarders, audit_log, workspaces, users
    RESTART IDENTITY CASCADE`;
  resetMetrics();
});

async function seedWorkspace(): Promise<{ workspaceId: string; userId: string }> {
  const [u] = await db
    .insert(schema.users)
    .values({ email: `u-${Math.random()}@x.com`, passwordHash: 'h', name: 'A' })
    .returning();
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!u || !ws) throw new Error('seed failed');
  return { workspaceId: ws.id, userId: u.id };
}

describe('siem delivery metrics', () => {
  it('records cairn_siem_delivery_total{forwarder_kind, status} after success', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 'http',
      name: 't',
      endpoint: 'http://example.invalid',
      credentialSecret: null,
      options: {},
      enabled: true,
    });
    const audit = await db.transaction((tx) =>
      recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        action: 'page.published',
        targetType: null,
        targetId: null,
        metadata: {},
      }),
    );
    await dispatchAuditEvent(
      {
        id: audit.id,
        workspaceId: audit.workspaceId,
        actorUserId: audit.actorUserId,
        action: audit.action,
        targetType: audit.targetType,
        targetId: audit.targetId,
        metadata: {},
        createdAt: audit.createdAt,
      },
      { senders: { http: vi.fn().mockResolvedValue(undefined), syslog: vi.fn() }, db },
    );
    const dump = await metricsRegistry().metrics();
    expect(dump).toContain('cairn_siem_delivery_total');
    expect(dump).toMatch(
      /cairn_siem_delivery_total\{forwarder_kind="http",status="success"\}\s+1/,
    );
    expect(dump).toContain('cairn_siem_delivery_latency_seconds');
  });

  it('labels a retry failure as status="retry"', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 'http',
      name: 't',
      endpoint: 'http://example.invalid',
      credentialSecret: null,
      options: {},
      enabled: true,
    });
    const audit = await db.transaction((tx) =>
      recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        action: 'page.published',
        targetType: null,
        targetId: null,
        metadata: {},
      }),
    );
    await dispatchAuditEvent(
      {
        id: audit.id,
        workspaceId: audit.workspaceId,
        actorUserId: audit.actorUserId,
        action: audit.action,
        targetType: audit.targetType,
        targetId: audit.targetId,
        metadata: {},
        createdAt: audit.createdAt,
      },
      { senders: { http: vi.fn().mockRejectedValue(new Error('boom')), syslog: vi.fn() }, db },
    );
    const dump = await metricsRegistry().metrics();
    expect(dump).toMatch(
      /cairn_siem_delivery_total\{forwarder_kind="http",status="retry"\}\s+1/,
    );
  });
});
