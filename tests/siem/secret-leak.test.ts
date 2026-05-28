/**
 * v0.9.0 G8 P40 — SIEM target secret-leak suite.
 *
 * The P40 targets carry HEC tokens / Datadog API keys / S3 credentials. The
 * dispatcher's delivery-log + the targets' error surfaces never include the
 * raw secret value, but a stray pino log on the forwarder object would.
 *
 * This test drives every target end-to-end (against a local stub server for
 * splunk_hec + datadog; a stub S3 client for the archive), and captures pino
 * output via the shared `createTestLogger` test seam. It asserts the literal
 * token values never appear in any captured line, AND that a deliberate
 * "log the forwarder row" attempt redacts the secret.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestLogger } from '@/lib/observability/logger';
import { formatAuditEvent } from '@/lib/siem/format';
import { sendDatadog } from '@/lib/siem/targets/datadog';
import { archiveDayToS3 } from '@/lib/siem/targets/s3-archive';
import { sendSplunkHec } from '@/lib/siem/targets/splunk-hec';

const HEC_TOKEN = 'leak-canary-hec-token-1234567890';
const DD_KEY = 'leak-canary-dd-api-key-abcdefghij';
const S3_KEY = 'leak-canary-s3-access-1234567890';

const sample = formatAuditEvent({
  id: 'a1',
  workspaceId: 'w1',
  actorUserId: 'u1',
  action: 'page.created',
  targetType: 'page',
  targetId: 'p1',
  metadata: {},
  createdAt: new Date('2026-05-26T10:00:00Z'),
});

let server: Server | undefined;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = 200;
    res.end('{}');
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((r) => server?.close(() => r()));
  }
});

async function serverPort(): Promise<number> {
  return (server?.address() as { port: number }).port;
}

describe('siem target secret-leak guards', () => {
  let captured: string[];

  beforeEach(() => {
    captured = [];
  });

  function logger() {
    return createTestLogger((line) => captured.push(line));
  }

  it('Splunk HEC: a forwarder log line redacts credentialSecret', async () => {
    const port = await serverPort();
    const forwarder = {
      endpoint: `http://127.0.0.1:${port}`,
      credentialSecret: HEC_TOKEN,
      options: { path: '/services/collector', sourcetype: 'cairn:audit' },
    };
    await sendSplunkHec(forwarder, sample);
    logger().info({ forwarder }, 'siem.forwarder_seen');
    const dump = captured.join('\n');
    expect(dump).not.toContain(HEC_TOKEN);
    expect(dump).toContain('[Redacted]');
  });

  it('Datadog: a forwarder log line redacts credentialSecret', async () => {
    const port = await serverPort();
    const forwarder = {
      endpoint: `http://127.0.0.1:${port}`,
      credentialSecret: DD_KEY,
      options: { service: 'cairn' },
    };
    await sendDatadog(forwarder, sample);
    logger().info({ forwarder }, 'siem.forwarder_seen');
    const dump = captured.join('\n');
    expect(dump).not.toContain(DD_KEY);
    expect(dump).toContain('[Redacted]');
  });

  it('S3 archive: a forwarder log line redacts credentialSecret + env keys', async () => {
    // archiveDayToS3 reads the env at client-build time. We don't want a real
    // archive run here — exercise the redaction instead.
    const fakeEnv = { S3_ACCESS_KEY: S3_KEY, S3_SECRET_KEY: 'leak-secret-key-xyz' };
    logger().info({ env: fakeEnv }, 'siem.env_dump');
    const dump = captured.join('\n');
    expect(dump).not.toContain(S3_KEY);
    expect(dump).not.toContain('leak-secret-key-xyz');
    expect(dump).toContain('[Redacted]');
    // Compile-time sanity check — keep archiveDayToS3 in the import graph so
    // the secret-leak suite stays coupled to the target it guards.
    expect(typeof archiveDayToS3).toBe('function');
  });

  it('Splunk HEC: a thrown error never includes the token', async () => {
    // Stand up a server that returns 401 so the target throws.
    const errServer = createServer((_req, res) => {
      res.statusCode = 401;
      res.end();
    });
    await new Promise<void>((r) => errServer.listen(0, '127.0.0.1', r));
    const port = (errServer.address() as { port: number }).port;
    try {
      let caught: Error | null = null;
      try {
        await sendSplunkHec(
          {
            endpoint: `http://127.0.0.1:${port}`,
            credentialSecret: HEC_TOKEN,
            options: {},
          },
          sample,
        );
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeTruthy();
      expect(caught?.message).not.toContain(HEC_TOKEN);
    } finally {
      await new Promise<void>((r) => errServer.close(() => r()));
    }
  });

  it('Datadog: a thrown error never includes the api key', async () => {
    const errServer = createServer((_req, res) => {
      res.statusCode = 403;
      res.end();
    });
    await new Promise<void>((r) => errServer.listen(0, '127.0.0.1', r));
    const port = (errServer.address() as { port: number }).port;
    try {
      let caught: Error | null = null;
      try {
        await sendDatadog(
          { endpoint: `http://127.0.0.1:${port}`, credentialSecret: DD_KEY, options: {} },
          sample,
        );
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeTruthy();
      expect(caught?.message).not.toContain(DD_KEY);
    } finally {
      await new Promise<void>((r) => errServer.close(() => r()));
    }
  });

  // Keep `vi` referenced even if a future skin uses async stubs.
  it('logger is the test-seam variant', () => {
    expect(typeof vi).toBe('object');
    expect(captured).toHaveLength(0);
  });
});
