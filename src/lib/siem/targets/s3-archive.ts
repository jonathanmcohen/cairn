/**
 * v0.9.0 G8 P40 — S3 NDJSON daily archive target.
 *
 * Unlike syslog / http / splunk_hec / datadog (which fire per-audit-event via
 * the dispatcher), the S3 archive runs once a day via cron: for each enabled
 * `kind='s3'` forwarder, this function selects every `audit_log` row in the
 * requested UTC day for that workspace, serializes them as NDJSON (one
 * envelope per line), gzips the body, and writes one object per workspace per
 * day to `s3://<bucket>/<prefix>/<workspaceId>/audit/YYYY-MM-DD.ndjson.gz`.
 *
 * The forwarder's `endpoint` is the bucket URL (`s3://my-bucket`); the
 * S3 client itself is configured from process-level env vars
 * (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) — the same
 * scheme the v0.5 P5 file-storage adapter uses. Per-forwarder bucket override
 * means an operator can fan to multiple buckets (e.g. one per compliance
 * region) without coupling to FILE_BACKEND.
 *
 * Empty days are a no-op: zero rows -> zero S3 calls -> zero delivery-log
 * rows. The cron driver in `src/lib/siem/archive.ts` interprets `rowCount=0`
 * as "skip the log row entirely" because P39's `siem_delivery_log.audit_event_id`
 * is `NOT NULL` and there's no event to point at.
 */

import { gzipSync } from 'node:zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { and, eq, gte, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { formatAuditEvent } from '../format';

type Db = PostgresJsDatabase<typeof schema>;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bucketFromEndpoint(endpoint: string): string {
  // Accept `s3://bucket` or `s3://bucket/prefix-extra` — only the host matters.
  // `new URL` parses `s3://bucket` with `host=bucket` on Node 22+.
  const url = new URL(endpoint);
  if (url.protocol !== 's3:') {
    throw new Error(`s3 endpoint must be s3://<bucket>: got ${endpoint}`);
  }
  if (!url.host) throw new Error(`s3 endpoint missing bucket: got ${endpoint}`);
  return url.host;
}

function buildClient(): S3Client {
  // Mirrors v0.5 P5 S3Storage configuration so a self-hosted MinIO/B2/etc.
  // works without per-forwarder credentials. Operators wire the env vars at
  // process start; the forwarder row carries only the bucket name (in the
  // endpoint string) + per-workspace prefix.
  const cfg = env();
  const accessKey = cfg.S3_ACCESS_KEY;
  const secretKey = cfg.S3_SECRET_KEY;
  return new S3Client({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials:
      accessKey && secretKey ? { accessKeyId: accessKey, secretAccessKey: secretKey } : undefined,
  });
}

export type S3ArchiveInput = {
  workspaceId: string;
  forwarderId: string;
  /** Any timestamp inside the target UTC day. Only the YYYY-MM-DD part matters. */
  date: Date;
  /** Test seam — inject a stub. Production uses the singleton. */
  db?: Db;
  /** Test seam — inject a stub S3 client. Production builds from env. */
  s3Client?: S3Client;
};

export type S3ArchiveResult = {
  rowCount: number;
  bytes: number;
  key: string | null;
};

export async function archiveDayToS3(input: S3ArchiveInput): Promise<S3ArchiveResult> {
  const db = input.db ?? getDb();
  const start = new Date(`${ymd(input.date)}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const [forwarder] = await db
    .select()
    .from(schema.siemForwarders)
    .where(eq(schema.siemForwarders.id, input.forwarderId))
    .limit(1);
  if (!forwarder) throw new Error('forwarder not found');
  if (forwarder.kind !== 's3') throw new Error(`expected s3 forwarder, got ${forwarder.kind}`);

  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.workspaceId, input.workspaceId),
        gte(schema.auditLog.createdAt, start),
        lt(schema.auditLog.createdAt, end),
      ),
    );

  if (rows.length === 0) {
    return { rowCount: 0, bytes: 0, key: null };
  }

  const ndjson = rows
    .map((r) =>
      JSON.stringify(
        formatAuditEvent({
          id: r.id,
          workspaceId: r.workspaceId,
          actorUserId: r.actorUserId,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          metadata: (r.metadata ?? {}) as Record<string, unknown>,
          createdAt: r.createdAt,
        }),
      ),
    )
    .join('\n');
  const gz = gzipSync(Buffer.from(ndjson, 'utf8'));

  const prefix = ((forwarder.options as { prefix?: string }).prefix ?? 'cairn').replace(
    /^\/+|\/+$/g,
    '',
  );
  const key = `${prefix}/${input.workspaceId}/audit/${ymd(input.date)}.ndjson.gz`;
  const bucket = bucketFromEndpoint(forwarder.endpoint);

  const client = input.s3Client ?? buildClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: gz,
      ContentType: 'application/x-ndjson',
      ContentEncoding: 'gzip',
    }),
  );

  return { rowCount: rows.length, bytes: gz.byteLength, key };
}
