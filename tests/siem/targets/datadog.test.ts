import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatAuditEvent } from '@/lib/siem/format';
import { sendDatadog } from '@/lib/siem/targets/datadog';

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

type CapturedReq = { url: string; headers: Record<string, string>; body: string };

describe('sendDatadog', () => {
  let server: Server | undefined;
  let lastReq: CapturedReq | null = null;
  let respondWith = 202;

  beforeEach(() => {
    lastReq = null;
    respondWith = 202;
    server = createServer((req, res) => {
      let buf = '';
      req.on('data', (c) => {
        buf += c;
      });
      req.on('end', () => {
        lastReq = {
          url: req.url ?? '',
          headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
          body: buf,
        };
        res.statusCode = respondWith;
        res.end('{}');
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => {
        server?.close(() => r());
      });
      server = undefined;
    }
  });

  async function port(): Promise<number> {
    await new Promise<void>((r) => {
      server?.listen(0, '127.0.0.1', r);
    });
    return (server?.address() as { port: number }).port;
  }

  it('POSTs to /api/v2/logs with DD-API-KEY header + Datadog-shaped array', async () => {
    const p = await port();
    await sendDatadog(
      {
        endpoint: `http://127.0.0.1:${p}`,
        credentialSecret: 'dd_api_key_xxx',
        options: { service: 'cairn-app' },
      },
      sample,
    );
    expect(lastReq?.url).toBe('/api/v2/logs');
    expect(lastReq?.headers['dd-api-key']).toBe('dd_api_key_xxx');
    const body = JSON.parse(lastReq?.body ?? '[]') as Array<{
      ddsource: string;
      service: string;
      message: string;
      ddtags: string;
    }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.ddsource).toBe('cairn');
    expect(body[0]?.service).toBe('cairn-app');
    expect(body[0]?.message).toBe('page.created');
    expect(body[0]?.ddtags).toContain('workspace:w1');
  });

  it('joins extra tags option into ddtags', async () => {
    const p = await port();
    await sendDatadog(
      {
        endpoint: `http://127.0.0.1:${p}`,
        credentialSecret: 'dd',
        options: { tags: ['env:prod', 'team:platform'] },
      },
      sample,
    );
    const body = JSON.parse(lastReq?.body ?? '[]') as Array<{ ddtags: string }>;
    expect(body[0]?.ddtags).toContain('env:prod');
    expect(body[0]?.ddtags).toContain('team:platform');
    expect(body[0]?.ddtags).toContain('workspace:w1');
  });

  it('throws on non-2xx', async () => {
    respondWith = 403;
    const p = await port();
    await expect(
      sendDatadog(
        { endpoint: `http://127.0.0.1:${p}`, credentialSecret: 'dd', options: {} },
        sample,
      ),
    ).rejects.toThrow(/403/);
  });

  it('refuses without credentialSecret', async () => {
    await expect(
      sendDatadog({ endpoint: 'http://127.0.0.1:1', credentialSecret: null, options: {} }, sample),
    ).rejects.toThrow(/DD-API-KEY/);
  });
});
