import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeHttp, resetMetrics } from '@/lib/observability/metrics';

const ORIGINAL = process.env.CAIRN_METRICS_TOKEN;

beforeEach(() => {
  resetMetrics();
  vi.resetModules();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CAIRN_METRICS_TOKEN;
  else process.env.CAIRN_METRICS_TOKEN = ORIGINAL;
});

function req(token?: string): Request {
  return new Request('http://localhost/metrics', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('GET /metrics', () => {
  it('returns 404 when CAIRN_METRICS_TOKEN is unset (off by default)', async () => {
    delete process.env.CAIRN_METRICS_TOKEN;
    const { GET } = await import('@/app/metrics/route');
    const res = await GET(req('anything'));
    expect(res.status).toBe(404);
  });

  it('returns 401 when the token is set but the bearer is absent', async () => {
    process.env.CAIRN_METRICS_TOKEN = 'super-secret-metrics-token';
    const { GET } = await import('@/app/metrics/route');
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('returns 401 for a wrong token', async () => {
    process.env.CAIRN_METRICS_TOKEN = 'super-secret-metrics-token';
    const { GET } = await import('@/app/metrics/route');
    const res = await GET(req('wrong-token-value-here'));
    expect(res.status).toBe(401);
  });

  it('returns 200 + Prometheus exposition with the right token', async () => {
    process.env.CAIRN_METRICS_TOKEN = 'super-secret-metrics-token';
    observeHttp({ method: 'GET', route: '/api/v1/pages', status: 200, durationSec: 0.01 });
    const { GET } = await import('@/app/metrics/route');
    const res = await GET(req('super-secret-metrics-token'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('http_requests_total');
  });

  it('LEAK GUARD: the exposition never echoes the token nor any uuid', async () => {
    process.env.CAIRN_METRICS_TOKEN = 'super-secret-metrics-token';
    observeHttp({ method: 'GET', route: '/api/v1/pages/:id', status: 200, durationSec: 0.01 });
    const { GET } = await import('@/app/metrics/route');
    const body = await (await GET(req('super-secret-metrics-token'))).text();
    expect(body).not.toContain('super-secret-metrics-token');
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
