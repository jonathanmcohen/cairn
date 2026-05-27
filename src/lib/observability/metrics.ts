import { Counter, Gauge, Histogram, Registry } from 'prom-client';

let registry: Registry;
let httpDuration: Histogram<'method' | 'route' | 'status'>;
let httpTotal: Counter<'method' | 'route' | 'status'>;
let dbDuration: Histogram<'operation'>;
let collabConnections: Gauge;
let collabDocUpdates: Counter;
let webhookTotal: Counter<'event' | 'outcome'>;
let webhookDuration: Histogram<'event' | 'outcome'>;
let notificationsSent: Counter<'channel'>;
let mcpToolTotal: Counter<'tool' | 'outcome'>;
let mcpToolDuration: Histogram<'tool'>;
let embeddingTotal: Counter<'provider' | 'outcome'>;
let embeddingDuration: Histogram<'provider'>;
let automationRuleTotal: Counter<'action_type' | 'outcome'>;
let connectorSyncTotal: Counter<'kind' | 'outcome'>;
let connectorSyncDuration: Histogram<'kind'>;
// v0.9.0 G8 P39 — SIEM forwarder delivery counters.
let siemDeliveryTotal: Counter<'forwarder_kind' | 'status'>;
let siemDeliveryDuration: Histogram<'forwarder_kind' | 'status'>;

function build(): void {
  registry = new Registry();
  httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  dbDuration = new Histogram({
    name: 'db_query_duration_seconds',
    help: 'Database query latency in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [registry],
  });
  collabConnections = new Gauge({
    name: 'collab_active_connections',
    help: 'Currently open collaboration websocket connections',
    registers: [registry],
  });
  collabDocUpdates = new Counter({
    name: 'collab_doc_updates_total',
    help: 'Total Yjs document updates applied',
    registers: [registry],
  });
  webhookTotal = new Counter({
    name: 'webhook_delivery_total',
    help: 'Total outbound webhook delivery attempts',
    labelNames: ['event', 'outcome'],
    registers: [registry],
  });
  webhookDuration = new Histogram({
    name: 'webhook_delivery_duration_seconds',
    help: 'Outbound webhook delivery latency in seconds',
    labelNames: ['event', 'outcome'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  notificationsSent = new Counter({
    name: 'notifications_sent_total',
    help: 'Total notifications sent',
    labelNames: ['channel'],
    registers: [registry],
  });
  mcpToolTotal = new Counter({
    name: 'mcp_tool_called_total',
    help: 'Total MCP tool invocations by tool and outcome',
    labelNames: ['tool', 'outcome'],
    registers: [registry],
  });
  mcpToolDuration = new Histogram({
    name: 'mcp_tool_duration_seconds',
    help: 'MCP tool dispatch latency in seconds',
    labelNames: ['tool'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  embeddingTotal = new Counter({
    name: 'embedding_generation_total',
    help: 'Total embedding generations by provider and outcome',
    labelNames: ['provider', 'outcome'],
    registers: [registry],
  });
  embeddingDuration = new Histogram({
    name: 'embedding_generation_duration_seconds',
    help: 'Embedding generation latency in seconds',
    labelNames: ['provider'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  automationRuleTotal = new Counter({
    name: 'automation_rule_fired_total',
    help: 'Total automation-rule firings by action type and outcome',
    labelNames: ['action_type', 'outcome'],
    registers: [registry],
  });
  connectorSyncTotal = new Counter({
    name: 'connector_sync_total',
    help: 'Total connector sync runs by adapter kind and outcome',
    labelNames: ['kind', 'outcome'],
    registers: [registry],
  });
  connectorSyncDuration = new Histogram({
    name: 'connector_sync_duration_seconds',
    help: 'Connector sync run duration in seconds',
    labelNames: ['kind'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
    registers: [registry],
  });
  // v0.9.0 G8 P39 — every SIEM forwarder delivery increments this counter
  // with the forwarder kind (syslog | http | ...) + outcome
  // (success | retry | failed).
  siemDeliveryTotal = new Counter({
    name: 'cairn_siem_delivery_total',
    help: 'Total SIEM forwarder delivery attempts by forwarder kind and status',
    labelNames: ['forwarder_kind', 'status'],
    registers: [registry],
  });
  siemDeliveryDuration = new Histogram({
    name: 'cairn_siem_delivery_latency_seconds',
    help: 'SIEM forwarder per-attempt delivery latency in seconds',
    labelNames: ['forwarder_kind', 'status'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
}

build();

export function metricsRegistry(): Registry {
  return registry;
}

export function resetMetrics(): void {
  build();
}

export function observeHttp(s: {
  method: string;
  route: string;
  status: number;
  durationSec: number;
}): void {
  const labels = { method: s.method, route: s.route, status: String(s.status) };
  httpTotal.inc(labels);
  httpDuration.observe(labels, s.durationSec);
}

export function observeDb(s: { operation: string; durationSec: number }): void {
  dbDuration.observe({ operation: s.operation }, s.durationSec);
}

export function setCollabConnections(n: number): void {
  collabConnections.set(n);
}

export function incCollabDocUpdate(n = 1): void {
  collabDocUpdates.inc(n);
}

export function incWebhook(s: {
  event: string;
  outcome: 'success' | 'failed';
  durationSec: number;
}): void {
  const labels = { event: s.event, outcome: s.outcome };
  webhookTotal.inc(labels);
  webhookDuration.observe(labels, s.durationSec);
}

export function incNotificationsSent(s: { channel: string }): void {
  notificationsSent.inc({ channel: s.channel });
}

/**
 * The closed-enum outcomes vocabulary for MCP tool calls (per spec §5.4):
 * success | scope_denied | allowlist_denied | acl_denied | rate_limited |
 * handler_error. The dispatcher (P6) emits these strings; callers MUST NOT pass
 * arbitrary outcome values — the cardinality guarantee depends on this being a
 * closed set.
 */
export type McpOutcome =
  | 'success'
  | 'scope_denied'
  | 'allowlist_denied'
  | 'acl_denied'
  | 'rate_limited'
  | 'handler_error';

export type EmbeddingProvider = 'local' | 'remote';
export type ConnectorKind = 'google_sheets' | 'airtable' | 'csv';
export type AutomationActionType = 'notify' | 'send_webhook' | 'set_property' | 'create_page';

export function incMcpTool(s: { tool: string; outcome: McpOutcome; durationSec: number }): void {
  const labels = { tool: s.tool, outcome: s.outcome };
  mcpToolTotal.inc(labels);
  mcpToolDuration.observe({ tool: s.tool }, s.durationSec);
}

export function incEmbedding(s: {
  provider: EmbeddingProvider;
  outcome: 'success' | 'failed';
  durationSec: number;
}): void {
  embeddingTotal.inc({ provider: s.provider, outcome: s.outcome });
  embeddingDuration.observe({ provider: s.provider }, s.durationSec);
}

export function incAutomationRule(s: {
  actionType: AutomationActionType;
  outcome: 'success' | 'failed' | 'condition_unmet';
}): void {
  automationRuleTotal.inc({ action_type: s.actionType, outcome: s.outcome });
}

export function incConnectorSync(s: {
  kind: ConnectorKind;
  outcome: 'success' | 'failed' | 'conflict';
  durationSec: number;
}): void {
  connectorSyncTotal.inc({ kind: s.kind, outcome: s.outcome });
  connectorSyncDuration.observe({ kind: s.kind }, s.durationSec);
}

/**
 * v0.9.0 G8 P39 — SIEM forwarder delivery outcomes. `forwarder_kind` is the
 * closed set from the migration CHECK (`syslog | http | splunk_hec | datadog
 * | s3`); `status` mirrors the `siem_delivery_log.status` enum
 * (`success | retry | failed`). The dispatcher passes the per-attempt
 * latency (wall clock around the sender call) so the histogram captures
 * both success and failure paths.
 */
export type SiemForwarderKind = 'syslog' | 'http' | 'splunk_hec' | 'datadog' | 's3';
export type SiemDeliveryStatus = 'success' | 'retry' | 'failed';

export function incSiemDelivery(s: {
  forwarderKind: SiemForwarderKind | string;
  status: SiemDeliveryStatus;
  durationSec: number;
}): void {
  const labels = { forwarder_kind: s.forwarderKind, status: s.status };
  siemDeliveryTotal.inc(labels);
  siemDeliveryDuration.observe(labels, s.durationSec);
}
