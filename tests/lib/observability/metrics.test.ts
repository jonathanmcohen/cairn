import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  incNotificationsSent,
  incWebhook,
  metricsRegistry,
  observeDb,
  observeHttp,
  resetMetrics,
  setCollabConnections,
} from '@/lib/observability/metrics';

beforeEach(() => resetMetrics());
afterEach(() => resetMetrics());

describe('metrics registry', () => {
  it('records http requests with only method/route/status labels', async () => {
    observeHttp({ method: 'GET', route: '/api/v1/pages', status: 200, durationSec: 0.012 });
    const text = await metricsRegistry().metrics();
    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/v1/pages",status="200"} 1',
    );
    expect(text).toContain('http_request_duration_seconds');
  });

  it('exposes the full custom metric set', async () => {
    observeHttp({ method: 'POST', route: '/api/v1/pages', status: 201, durationSec: 0.05 });
    observeDb({ operation: 'select', durationSec: 0.003 });
    setCollabConnections(4);
    incWebhook({ event: 'page.created', outcome: 'success', durationSec: 0.2 });
    incNotificationsSent({ channel: 'in_app' });
    const text = await metricsRegistry().metrics();
    for (const name of [
      'http_request_duration_seconds',
      'http_requests_total',
      'db_query_duration_seconds',
      'collab_active_connections',
      'collab_doc_updates_total',
      'webhook_delivery_total',
      'webhook_delivery_duration_seconds',
      'notifications_sent_total',
    ]) {
      expect(text).toContain(name);
    }
    expect(text).toContain('collab_active_connections 4');
  });

  it('LEAK GUARD: no metric declares a tenant/user/page label', () => {
    const banned = [
      'workspace',
      'workspace_id',
      'tenant',
      'user',
      'user_id',
      'page',
      'page_id',
      'row',
      'row_id',
      'email',
    ];
    const json = metricsRegistry().getMetricsAsArray() as Array<{
      name: string;
      aggregator?: unknown;
      labelNames?: string[];
    }>;
    for (const m of json) {
      const labels = (m as unknown as { labelNames?: string[] }).labelNames ?? [];
      for (const label of labels) {
        expect(banned, `metric ${m.name} declares banned label "${label}"`).not.toContain(
          label.toLowerCase(),
        );
      }
    }
  });

  it('LEAK GUARD: a concrete id in a route value never reaches the exposition', async () => {
    observeHttp({ method: 'GET', route: '/api/v1/pages/:id', status: 200, durationSec: 0.01 });
    const text = await metricsRegistry().metrics();
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
