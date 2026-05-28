import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatAuditEvent } from '@/lib/siem/format';
import { sendSplunkHec } from '@/lib/siem/targets/splunk-hec';

const sample = formatAuditEvent({
  id: 'a1',
  workspaceId: 'w1',
  actorUserId: 'u1',
  action: 'page.created',
  targetType: 'page',
  targetId: 'p1',
  metadata: { title: 'x' },
  createdAt: new Date('2026-05-26T10:00:00Z'),
});

type CapturedReq = { url: string; headers: Record<string, string>; body: string };

describe('sendSplunkHec', () => {
  let server: Server | undefined;
  let lastReq: CapturedReq | null = null;
  let respondWith = 200;

  beforeEach(() => {
    lastReq = null;
    respondWith = 200;
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
        res.end(JSON.stringify({ text: 'Success', code: 0 }));
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

  it('POSTs to /services/collector with Splunk auth header + envelope', async () => {
    const p = await port();
    await sendSplunkHec(
      {
        endpoint: `http://127.0.0.1:${p}`,
        credentialSecret: 'tok_xxx',
        options: { sourcetype: 'cairn:audit' },
      },
      sample,
    );
    expect(lastReq?.url).toBe('/services/collector');
    expect(lastReq?.headers.authorization).toBe('Splunk tok_xxx');
    const body = JSON.parse(lastReq?.body ?? '{}') as {
      event: typeof sample;
      sourcetype: string;
      source: string;
    };
    expect(body.event).toEqual(sample);
    expect(body.sourcetype).toBe('cairn:audit');
    expect(body.source).toBe('cairn');
  });

  it('defaults sourcetype + source when options are absent', async () => {
    const p = await port();
    await sendSplunkHec(
      { endpoint: `http://127.0.0.1:${p}`, credentialSecret: 'tok', options: {} },
      sample,
    );
    const body = JSON.parse(lastReq?.body ?? '{}') as { sourcetype: string; source: string };
    expect(body.sourcetype).toBe('cairn:audit');
    expect(body.source).toBe('cairn');
  });

  it('throws on non-200 + includes status', async () => {
    respondWith = 401;
    const p = await port();
    await expect(
      sendSplunkHec(
        { endpoint: `http://127.0.0.1:${p}`, credentialSecret: 'tok', options: {} },
        sample,
      ),
    ).rejects.toThrow(/401/);
  });

  it('supports a custom path override via options.path', async () => {
    const p = await port();
    await sendSplunkHec(
      {
        endpoint: `http://127.0.0.1:${p}`,
        credentialSecret: 'tok',
        options: { path: '/custom/hec' },
      },
      sample,
    );
    expect(lastReq?.url).toBe('/custom/hec');
  });

  it('refuses without credentialSecret', async () => {
    await expect(
      sendSplunkHec(
        { endpoint: 'http://127.0.0.1:1', credentialSecret: null, options: {} },
        sample,
      ),
    ).rejects.toThrow(/token/i);
  });
});
