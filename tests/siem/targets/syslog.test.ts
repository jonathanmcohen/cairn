import { createSocket, type Socket } from 'node:dgram';
import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatAuditEvent } from '@/lib/siem/format';
import { sendSyslog } from '@/lib/siem/targets/syslog';

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

describe('sendSyslog', () => {
  let udp: Socket | undefined;
  let tcp: Server | undefined;
  afterEach(async () => {
    if (udp) {
      await new Promise<void>((r) => {
        udp?.close(() => r());
      });
      udp = undefined;
    }
    if (tcp) {
      await new Promise<void>((r) => {
        tcp?.close(() => r());
      });
      tcp = undefined;
    }
  });

  it('UDP: emits an RFC 5424 frame containing the JSON envelope', async () => {
    udp = createSocket('udp4');
    await new Promise<void>((r) => {
      udp?.bind(0, '127.0.0.1', r);
    });
    const port = (udp.address() as { port: number }).port;
    const messageReceived = new Promise<string>((r) => {
      udp?.on('message', (b) => r(b.toString('utf8')));
    });
    await sendSyslog({ endpoint: `udp://127.0.0.1:${port}`, options: {} }, sample);
    const frame = await messageReceived;
    expect(frame).toMatch(/^<134>1 2026-05-26T10:00:00\.000Z /);
    expect(frame).toContain('"action":"page.published"');
    expect(frame).toContain('cairn');
  });

  it('TCP: emits an RFC 5424 frame with a trailing newline', async () => {
    const messageReceived = new Promise<string>((resolve) => {
      tcp = createServer((sock) => {
        let buf = '';
        sock.on('data', (b) => {
          buf += b.toString('utf8');
        });
        sock.on('end', () => resolve(buf));
      });
    });
    await new Promise<void>((r) => {
      tcp?.listen(0, '127.0.0.1', r);
    });
    const port = (tcp?.address() as { port: number }).port;
    await sendSyslog({ endpoint: `tcp://127.0.0.1:${port}`, options: {} }, sample);
    const frame = await messageReceived;
    expect(frame).toMatch(/^<134>1 /);
    expect(frame.endsWith('\n')).toBe(true);
    expect(frame).toContain('"action":"page.published"');
  });

  it('rejects unsupported schemes', async () => {
    await expect(
      sendSyslog({ endpoint: 'ftp://example.invalid:1', options: {} }, sample),
    ).rejects.toThrow(/unsupported syslog scheme/);
  });

  it('uses options.hostname when provided', async () => {
    udp = createSocket('udp4');
    await new Promise<void>((r) => {
      udp?.bind(0, '127.0.0.1', r);
    });
    const port = (udp.address() as { port: number }).port;
    const messageReceived = new Promise<string>((r) => {
      udp?.on('message', (b) => r(b.toString('utf8')));
    });
    await sendSyslog(
      { endpoint: `udp://127.0.0.1:${port}`, options: { hostname: 'cairn-prod' } },
      sample,
    );
    const frame = await messageReceived;
    expect(frame).toContain(' cairn-prod cairn ');
  });
});
