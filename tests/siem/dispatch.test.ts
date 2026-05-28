import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
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
    siem_delivery_log, siem_forwarders, audit_log, pages, workspaces, users,
    workspace_members
    RESTART IDENTITY CASCADE`;
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

describe('dispatchAuditEvent', () => {
  it('writes a success row when the target sender succeeds', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'http',
        name: 'test',
        endpoint: 'http://example.invalid/hook',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    const ok = vi.fn().mockResolvedValue(undefined);
    const audit = await db.transaction((tx) =>
      recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        action: 'page.published',
        targetType: 'page',
        targetId: forwarder?.id ?? null,
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
      { senders: { http: ok, syslog: vi.fn() }, db },
    );
    expect(ok).toHaveBeenCalledOnce();
    const log = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(eq(schema.siemDeliveryLog.forwarderId, forwarder?.id ?? ''));
    expect(log).toHaveLength(1);
    expect(log[0]?.status).toBe('success');
    expect(log[0]?.attempt).toBe(1);
    expect(log[0]?.error).toBeNull();
  });

  it('writes a retry row + next_attempt_at when the sender throws', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'http',
        name: 'test',
        endpoint: 'http://example.invalid/hook',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    const fail = vi.fn().mockRejectedValue(new Error('boom'));
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
      { senders: { http: fail, syslog: vi.fn() }, db },
    );
    const log = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(eq(schema.siemDeliveryLog.forwarderId, forwarder?.id ?? ''));
    expect(log).toHaveLength(1);
    expect(log[0]?.status).toBe('retry');
    expect(log[0]?.error).toBe('boom');
    expect(log[0]?.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('skips disabled forwarders', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 'http',
      name: 't',
      endpoint: 'http://example.invalid',
      credentialSecret: null,
      options: {},
      enabled: false,
    });
    const sender = vi.fn();
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
      { senders: { http: sender, syslog: vi.fn() }, db },
    );
    expect(sender).not.toHaveBeenCalled();
  });

  it('escalates to failed status after MAX_ATTEMPTS retries', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'http',
        name: 'x',
        endpoint: 'http://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    const fail = vi.fn().mockRejectedValue(new Error('boom'));
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
    const event = {
      id: audit.id,
      workspaceId: audit.workspaceId,
      actorUserId: audit.actorUserId,
      action: audit.action,
      targetType: audit.targetType,
      targetId: audit.targetId,
      metadata: {},
      createdAt: audit.createdAt,
    };
    // 4 attempts total — the 4th transitions to 'failed'.
    for (let i = 0; i < 4; i++) {
      await dispatchAuditEvent(event, { senders: { http: fail, syslog: vi.fn() }, db });
    }
    const log = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(eq(schema.siemDeliveryLog.forwarderId, forwarder?.id ?? ''));
    expect(log.find((l) => l.status === 'failed')).toBeTruthy();
    expect(log.filter((l) => l.status === 'retry').length).toBe(3);
  });

  it('skips dispatch entirely for the siem.delivery_failed meta-audit', async () => {
    const { workspaceId } = await seedWorkspace();
    await db.insert(schema.siemForwarders).values({
      workspaceId,
      kind: 'http',
      name: 'x',
      endpoint: 'http://example.invalid',
      credentialSecret: null,
      options: {},
      enabled: true,
    });
    const sender = vi.fn();
    await dispatchAuditEvent(
      {
        id: '00000000-0000-0000-0000-00000000a1ff',
        workspaceId,
        actorUserId: null,
        action: 'siem.delivery_failed',
        targetType: null,
        targetId: null,
        metadata: {},
        createdAt: new Date(),
      },
      { senders: { http: sender, syslog: vi.fn() }, db },
    );
    expect(sender).not.toHaveBeenCalled();
  });

  it('fans out to all enabled forwarders concurrently', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    const [httpFwd] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'http',
        name: 'h',
        endpoint: 'http://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    const [sysFwd] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'syslog',
        name: 's',
        endpoint: 'udp://127.0.0.1:514',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    const httpSender = vi.fn().mockResolvedValue(undefined);
    const sysSender = vi.fn().mockResolvedValue(undefined);
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
      { senders: { http: httpSender, syslog: sysSender }, db },
    );
    expect(httpSender).toHaveBeenCalledOnce();
    expect(sysSender).toHaveBeenCalledOnce();
    const httpLogs = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(eq(schema.siemDeliveryLog.forwarderId, httpFwd?.id ?? ''));
    const sysLogs = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(eq(schema.siemDeliveryLog.forwarderId, sysFwd?.id ?? ''));
    expect(httpLogs[0]?.status).toBe('success');
    expect(sysLogs[0]?.status).toBe('success');
  });

  it('does not deliver to a forwarder from a different workspace', async () => {
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    const [otherFwd] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId: b.workspaceId,
        kind: 'http',
        name: 'other',
        endpoint: 'http://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
    const sender = vi.fn();
    const audit = await db.transaction((tx) =>
      recordAudit(tx, {
        workspaceId: a.workspaceId,
        actorUserId: a.userId,
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
      { senders: { http: sender, syslog: vi.fn() }, db },
    );
    expect(sender).not.toHaveBeenCalled();
    const otherLogs = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(eq(schema.siemDeliveryLog.forwarderId, otherFwd?.id ?? ''));
    expect(otherLogs).toHaveLength(0);
  });

  it('logs sender_missing for an unknown kind without throwing', async () => {
    const { workspaceId, userId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'splunk_hec', // valid in CHECK but no sender wired in P39
        name: 'p40-target',
        endpoint: 'http://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
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
    await expect(
      dispatchAuditEvent(
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
        { senders: { http: vi.fn(), syslog: vi.fn() }, db },
      ),
    ).resolves.toBeUndefined();
    // No delivery log row was written for this forwarder — only sender_missing.
    const logs = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(eq(schema.siemDeliveryLog.forwarderId, forwarder?.id ?? ''));
    expect(logs).toHaveLength(0);
  });
});

describe('dispatch retry sweep', () => {
  it('re-runs a retry row whose next_attempt_at is in the past', async () => {
    const { dispatchAuditEvent: _ } = await import('@/lib/siem/dispatch');
    void _;
    const { retryPendingDeliveries } = await import('@/lib/siem/dispatch');
    const { workspaceId, userId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'http',
        name: 'r',
        endpoint: 'http://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
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
    // Seed a retry row pointed at the past.
    await db.insert(schema.siemDeliveryLog).values({
      forwarderId: forwarder?.id ?? '',
      auditEventId: audit.id,
      status: 'retry',
      attempt: 1,
      error: 'transient',
      nextAttemptAt: new Date(Date.now() - 1_000),
    });
    const ok = vi.fn().mockResolvedValue(undefined);
    const { swept } = await retryPendingDeliveries({
      senders: { http: ok, syslog: vi.fn() },
      db,
    });
    expect(swept).toBe(1);
    expect(ok).toHaveBeenCalledOnce();
    const logs = await db
      .select()
      .from(schema.siemDeliveryLog)
      .where(
        and(
          eq(schema.siemDeliveryLog.forwarderId, forwarder?.id ?? ''),
          eq(schema.siemDeliveryLog.auditEventId, audit.id),
        ),
      );
    expect(logs.some((l) => l.status === 'success')).toBe(true);
  });

  it('does not re-run a retry row whose next_attempt_at is still in the future', async () => {
    const { retryPendingDeliveries } = await import('@/lib/siem/dispatch');
    const { workspaceId, userId } = await seedWorkspace();
    const [forwarder] = await db
      .insert(schema.siemForwarders)
      .values({
        workspaceId,
        kind: 'http',
        name: 'r2',
        endpoint: 'http://example.invalid',
        credentialSecret: null,
        options: {},
        enabled: true,
      })
      .returning();
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
    await db.insert(schema.siemDeliveryLog).values({
      forwarderId: forwarder?.id ?? '',
      auditEventId: audit.id,
      status: 'retry',
      attempt: 1,
      error: 'transient',
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    const ok = vi.fn().mockResolvedValue(undefined);
    const { swept } = await retryPendingDeliveries({
      senders: { http: ok, syslog: vi.fn() },
      db,
    });
    expect(swept).toBe(0);
    expect(ok).not.toHaveBeenCalled();
  });
});
