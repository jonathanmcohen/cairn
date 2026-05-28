import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  incAutomationRule,
  incConnectorSync,
  incEmbedding,
  incMcpTool,
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

  it('exposes the v0.7.0 metric series (MCP, embedding, automation, connector)', async () => {
    incMcpTool({ tool: 'pages.list', outcome: 'success', durationSec: 0.01 });
    incEmbedding({ provider: 'local', outcome: 'success', durationSec: 0.05 });
    incAutomationRule({ actionType: 'notify', outcome: 'success' });
    incConnectorSync({ kind: 'google_sheets', outcome: 'success', durationSec: 1.2 });
    const text = await metricsRegistry().metrics();
    for (const name of [
      'mcp_tool_called_total',
      'mcp_tool_duration_seconds',
      'embedding_generation_total',
      'embedding_generation_duration_seconds',
      'automation_rule_fired_total',
      'connector_sync_total',
      'connector_sync_duration_seconds',
    ]) {
      expect(text).toContain(name);
    }
    // Spot-check that the recorded labels render correctly.
    expect(text).toContain('mcp_tool_called_total{tool="pages.list",outcome="success"} 1');
    expect(text).toContain('connector_sync_total{kind="google_sheets",outcome="success"} 1');
  });

  it('LEAK GUARD (v0.7.0 extension): new metrics declare only closed-enum labels', () => {
    const allowedLabels = new Set([
      'app', // default-label
      'method',
      'route',
      'status', // v0.6 P20 http
      'operation', // v0.6 P20 db
      'event', // v0.6 P20 webhook
      'channel', // v0.6 P20 notifications
      'outcome', // shared v0.7.0
      // v0.7.0 NEW:
      'tool',
      'provider',
      'action_type',
      'kind',
      // v0.9.0 G8 P39 — SIEM forwarder delivery labels. Closed-enum sets:
      //   forwarder_kind ∈ {syslog,http,splunk_hec,datadog,s3} (migration CHECK)
      //   status ∈ {success,retry,failed} (siem_delivery_log CHECK)
      'forwarder_kind',
    ]);
    const json = metricsRegistry().getMetricsAsArray() as Array<{
      name: string;
      labelNames?: string[];
    }>;
    for (const m of json) {
      for (const label of m.labelNames ?? []) {
        expect(allowedLabels, `metric ${m.name} declares unknown label "${label}"`).toContain(
          label,
        );
      }
    }
  });

  it('LEAK GUARD (v0.7.0): banned label keys still rejected on new metrics', async () => {
    incMcpTool({ tool: 'pages.list', outcome: 'success', durationSec: 0.01 });
    incConnectorSync({ kind: 'csv', outcome: 'failed', durationSec: 0.5 });
    const text = await metricsRegistry().metrics();
    expect(text).not.toMatch(/workspace_id/);
    expect(text).not.toMatch(/user_id/);
    expect(text).not.toMatch(/page_id/);
    expect(text).not.toMatch(/tenant/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
