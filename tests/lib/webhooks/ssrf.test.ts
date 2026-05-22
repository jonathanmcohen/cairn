import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

function mockResolve(addrs: string[]) {
  lookupMock.mockResolvedValue(
    addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
}

describe('SSRF guard', () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects non-http(s) schemes without resolving', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/scheme/i);
    await expect(assertPublicUrl('ftp://example.com')).rejects.toThrow(/scheme/i);
  });

  it('rejects literal loopback / link-local / private / metadata hosts', async () => {
    for (const url of [
      'http://127.0.0.1/x',
      'http://localhost/x',
      'http://0.0.0.0/x',
      'http://10.1.2.3/x',
      'http://192.168.0.5/x',
      'http://172.16.9.9/x',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://[::1]/x',
      'http://[fe80::1]/x',
      'http://[fc00::1]/x',
    ]) {
      mockResolve([new URL(url).hostname.replace(/^\[|\]$/g, '')]);
      await expect(assertPublicUrl(url), url).rejects.toThrow(
        /private|loopback|internal|link-local/i,
      );
    }
  });

  it('rejects a public hostname that RESOLVES to a private address (DNS rebinding)', async () => {
    mockResolve(['10.0.0.5']);
    await expect(assertPublicUrl('https://evil.example.com/hook')).rejects.toThrow(
      /private|internal/i,
    );
  });

  it('allows a public address', async () => {
    mockResolve(['93.184.216.34']); // example.com
    await expect(assertPublicUrl('https://example.com/hook')).resolves.toBeUndefined();
  });

  it('honors the WEBHOOK_ALLOW_PRIVATE escape hatch', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = '1';
    mockResolve(['192.168.1.50']);
    await expect(assertPublicUrl('http://nas.lan/hook')).resolves.toBeUndefined();
  });
});
