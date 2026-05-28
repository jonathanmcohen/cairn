import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatAuditEvent } from '@/lib/siem/format';
import { sendHttp } from '@/lib/siem/targets/http';

const sample = formatAuditEvent({
  id: 'a1',
  workspaceId: 'w1',
  actorUserId: 'u1',
  action: 'page.published',
  targetType: 'page',
  targetId: 'p1',
  metadata: {},
  createdAt: new Date('2026-05-26T10:00:00Z'),
});

type CapturedRequest = { headers: Record<string, string>; body: string; method: string };

describe('sendHttp', () => {
  let server: Server | undefined;
  let lastReq: CapturedRequest | null = null;
  let respondWith = 200;
  let hang = false;

  beforeEach(() => {
    lastReq = null;
    respondWith = 200;
    hang = false;
    server = createServer((req, res) => {
      let buf = '';
      req.on('data', (c) => {
        buf += c;
      });
      req.on('end', () => {
        lastReq = {
          headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
          body: buf,
          method: req.method ?? '',
        };
        if (hang) return;
        res.statusCode = respondWith;
        res.end();
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

  it('POSTs JSON to the configured endpoint', async () => {
    const p = await port();
    await sendHttp(
      { endpoint: `http://127.0.0.1:${p}/hook`, credentialSecret: null, options: {} },
      sample,
    );
    expect(lastReq?.method).toBe('POST');
    expect(lastReq?.headers['content-type']).toMatch(/json/);
    expect(JSON.parse(lastReq?.body ?? '{}')).toMatchObject({ action: 'page.published' });
  });

  it('adds Authorization: Bearer when credentialSecret is set', async () => {
    const p = await port();
    await sendHttp(
      {
        endpoint: `http://127.0.0.1:${p}/hook`,
        credentialSecret: 'tok_abc',
        options: {},
      },
      sample,
    );
    expect(lastReq?.headers.authorization).toBe('Bearer tok_abc');
  });

  it('omits Authorization when credentialSecret is null', async () => {
    const p = await port();
    await sendHttp(
      { endpoint: `http://127.0.0.1:${p}/hook`, credentialSecret: null, options: {} },
      sample,
    );
    expect(lastReq?.headers.authorization).toBeUndefined();
  });

  it('throws on 5xx', async () => {
    respondWith = 503;
    const p = await port();
    await expect(
      sendHttp(
        { endpoint: `http://127.0.0.1:${p}/hook`, credentialSecret: null, options: {} },
        sample,
      ),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('throws on 4xx', async () => {
    respondWith = 400;
    const p = await port();
    await expect(
      sendHttp(
        { endpoint: `http://127.0.0.1:${p}/hook`, credentialSecret: null, options: {} },
        sample,
      ),
    ).rejects.toThrow(/HTTP 400/);
  });

  it('respects the configured timeout', async () => {
    hang = true;
    const p = await port();
    await expect(
      sendHttp(
        {
          endpoint: `http://127.0.0.1:${p}/hook`,
          credentialSecret: null,
          options: { timeoutMs: 100 },
        },
        sample,
      ),
    ).rejects.toThrow();
  }, 5_000);
});
